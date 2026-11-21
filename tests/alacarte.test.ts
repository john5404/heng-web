import { describe, expect, it } from "vitest";
import { GET, POST } from "../src/app/api/orders/route";
import { addonLineText, linePrice, orderAlacarteDishes, registerSetChoices } from "../src/lib/alacarte";
import { createSession, hashPassword, SESSION_COOKIE } from "../src/lib/auth";
import { sql } from "../src/lib/db";
import { dishTotalsForSlot } from "../src/lib/kitchen";

const SHRIMP = "白灼蒜味蝦";
const SOUP = "上湯魚翅羹";
const DATE = "2027-03-02";

type Addon = { dish_name: string; quantity: number; price: number; amount_paid: number };
type Order = {
  id: string;
  price: number;
  addons: Addon[];
  menu_set_name: string | null;
  slot_id: string;
};

async function adminCookie(): Promise<string> {
  const existing = await sql<{ id: string }>("select id from users where username = $1", ["admin"]);
  if (!existing[0]) {
    const passwordHash = await hashPassword("temp-pass");
    await sql("insert into users (username, password_hash, role) values ($1, $2, 'admin')", [
      "admin",
      passwordHash,
    ]);
  }
  const rows = await sql<{ id: string }>("select id from users where username = $1", ["admin"]);
  return `${SESSION_COOKIE}=${createSession({ id: rows[0].id })}`;
}

function request(method: string, cookie: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      cookie,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function slotId(label: string, start: string, end: string): Promise<string> {
  const existing = await sql<{ id: string }>("select id from day_slots where label = $1 limit 1", [label]);
  if (existing[0]) return existing[0].id;
  const rows = await sql<{ id: string }>(
    `insert into day_slots (service_date, service_type, label, start_time, end_time)
     values ($1, 'takeout', $2, $3, $4)
     returning id`,
    [DATE, label, start, end],
  );
  return rows[0].id;
}

describe("單點 menu", () => {
  it("prices 上湯魚翅羹 at 1700, lists it first, and drops the standalone set", async () => {
    const dishes = await sql<{ id: string; name: string; alacarte_price: number }>(
      "select id, name, alacarte_price from dishes",
    );
    const sets = await sql<{ name: string }>("select name from menu_sets");
    const ordered = orderAlacarteDishes(
      dishes.map((dish) => ({ ...dish, unitPrice: Number(dish.alacarte_price) })),
    );
    expect(ordered[0]?.name).toBe(SOUP);
    expect(ordered[0]?.unitPrice).toBe(1700);
    expect(ordered.find((dish) => dish.name === SHRIMP)?.unitPrice).toBe(0);
    expect(ordered.filter((dish) => dish.name === SOUP)).toHaveLength(1);
    expect(sets.map((set) => set.name)).not.toContain("單點上湯魚翅羹");
    expect(registerSetChoices([{ name: "八千套餐" }, { name: "單點上湯魚翅羹" }]).map((set) => set.name)).toEqual([
      "八千套餐",
    ]);
    expect(linePrice(1700, 2)).toBe(3400);
    expect(addonLineText({ dish_name: SOUP, quantity: 1, price: 1700 })).toBe(`加購 ${SOUP} ×1 售價 1700`);
  });

  it("charges the menu 單點 price on a set, and ignores a price sent with the order", async () => {
    const cookie = await adminCookie();
    const slot = await slotId("單點測試時段", "12:00", "12:30");
    const otherId = await slotId("單點其他時段", "13:00", "13:30");
    const eight = await sql<{ id: string }>("select id from menu_sets where name = $1", ["八千套餐"]);
    const shrimp = await sql<{ id: string }>("select id from dishes where name = $1", [SHRIMP]);
    const soup = await sql<{ id: string }>("select id from dishes where name = $1", [SOUP]);

    const created = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "單點加套餐",
        phone: "0912555001",
        service_type: "takeout",
        menu_set_id: eight[0].id,
        slot_id: slot,
        alacarte: [
          { dish_id: shrimp[0].id, quantity: 2, price: 9999 },
          { dish_id: soup[0].id, quantity: 2 },
        ],
      }),
    );
    expect(created.status).toBe(201);
    const order = (await created.json()) as Order;
    expect(order.menu_set_name).toBe("八千套餐");
    expect(order.addons.find((addon) => addon.dish_name === SHRIMP)).toMatchObject({
      quantity: 2,
      price: 0,
      amount_paid: 0,
    });
    expect(order.addons.find((addon) => addon.dish_name === SOUP)).toMatchObject({
      quantity: 2,
      price: 3400,
      amount_paid: 2000,
    });

    const listed = await GET(request("GET", cookie, `http://localhost/api/orders?slot=${slot}`));
    const found = ((await listed.json()) as { orders: Order[] }).orders.find((item) => item.id === order.id);
    expect(addonLineText(found!.addons.find((addon) => addon.dish_name === SOUP)!)).toBe(
      `加購 ${SOUP} ×2 售價 3400`,
    );

    const totals = await dishTotalsForSlot(DATE, slot);
    const qty = (name: string) => totals.find((row) => row.dishName === name)?.qty ?? 0;
    expect(qty(SHRIMP)).toBe(3);
    expect(qty(SOUP)).toBe(3);
    expect(await dishTotalsForSlot(DATE, otherId)).toEqual([]);

    const missingQty = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "單點預設數量",
        phone: "0912555002",
        service_type: "takeout",
        menu_set_id: eight[0].id,
        slot_id: otherId,
        alacarte: [{ dish_id: soup[0].id }],
      }),
    );
    expect(missingQty.status).toBe(201);
    const defaulted = (await missingQty.json()) as Order;
    expect(defaulted.addons.find((addon) => addon.dish_name === SOUP)).toMatchObject({
      quantity: 1,
      price: 1700,
      amount_paid: 1700,
    });

    const badQty = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "單點壞數量",
        phone: "0912555003",
        service_type: "takeout",
        menu_set_id: eight[0].id,
        slot_id: slot,
        alacarte: [{ dish_id: shrimp[0].id, quantity: 0 }],
      }),
    );
    expect(badQty.status).toBe(400);
    const typed = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "單點打字",
        phone: "0912555004",
        service_type: "takeout",
        menu_set_id: eight[0].id,
        slot_id: slot,
        alacarte: [{ name: "臨時小菜", quantity: 1 }],
      }),
    );
    expect(typed.status).toBe(400);
    const stored = await sql<{ id: string }>(
      "select id from order_items where customer_name in ('單點壞數量', '單點打字')",
    );
    expect(stored).toEqual([]);
  });

  it("saves a 單點-only order and counts it in the kitchen", async () => {
    const cookie = await adminCookie();
    const slot = await slotId("純單點時段", "14:00", "14:30");
    const soup = await sql<{ id: string }>("select id from dishes where name = $1", [SOUP]);
    const created = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "純單點客人",
        phone: "0912555010",
        service_type: "takeout",
        menu_set_id: null,
        slot_id: slot,
        alacarte: [{ dish_id: soup[0].id, quantity: 1 }],
      }),
    );
    expect(created.status).toBe(201);
    const order = (await created.json()) as Order;
    expect(order.menu_set_name).toBeNull();
    expect(order.price).toBe(0);
    expect(order.addons.find((addon) => addon.dish_name === SOUP)).toMatchObject({
      quantity: 1,
      price: 1700,
      amount_paid: 1700,
    });

    const listed = await GET(request("GET", cookie, `http://localhost/api/orders?slot=${slot}`));
    const found = ((await listed.json()) as { orders: Order[] }).orders.find((item) => item.id === order.id);
    expect(found?.menu_set_name).toBeNull();
    expect(addonLineText(found!.addons[0])).toBe(`加購 ${SOUP} ×1 售價 1700`);
    const totals = await dishTotalsForSlot(DATE, slot);
    expect(totals.find((row) => row.dishName === SOUP)?.qty).toBe(1);

    const empty = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "空單點",
        phone: "0912555011",
        service_type: "takeout",
        slot_id: slot,
      }),
    );
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error?: string }).error).toBe("請至少加入一道單點");
  });
});
