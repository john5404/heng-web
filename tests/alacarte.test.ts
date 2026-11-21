import { describe, expect, it } from "vitest";
import { GET, POST } from "../src/app/api/orders/route";
import { alacarteMenu, addonLineText, linePrice, registerSetChoices } from "../src/lib/alacarte";
import { createSession, hashPassword, SESSION_COOKIE } from "../src/lib/auth";
import { sql } from "../src/lib/db";
import { dishTotalsForSlot } from "../src/lib/kitchen";

const SHRIMP = "白灼蒜味蝦";
const SOUP = "上湯魚翅羹";
const DATE = "2027-03-02";

type Addon = { dish_name: string; quantity: number; price: number; amount_paid: number };
type Order = { id: string; addons: Addon[]; menu_set_name: string | null };

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

async function slotId(): Promise<string> {
  const label = "單點測試時段";
  const existing = await sql<{ id: string }>("select id from day_slots where label = $1 limit 1", [label]);
  if (existing[0]) return existing[0].id;
  const rows = await sql<{ id: string }>(
    `insert into day_slots (service_date, service_type, label, start_time, end_time)
     values ($1, 'takeout', $2, '12:00', '12:30')
     returning id`,
    [DATE, label],
  );
  return rows[0].id;
}

describe("單點 menu", () => {
  it("lists every kitchen dish, prices a solo dish, and leaves set dishes at 0", async () => {
    const dishes = await sql<{ id: string; name: string }>("select id, name from dishes");
    const sets = await sql<{ id: string; name: string; price: number }>(
      "select id, name, price from menu_sets",
    );
    const links = await sql<{ menu_set_id: string; dish_id: string; sort_order: number; name: string }>(
      `select sd.menu_set_id, sd.dish_id, sd.sort_order, d.name
       from set_dishes sd
       join dishes d on d.id = sd.dish_id`,
    );
    const menu = alacarteMenu(
      dishes,
      sets.map((set) => ({
        price: Number(set.price),
        dishes: links
          .filter((link) => link.menu_set_id === set.id)
          .map((link) => ({ id: link.dish_id, name: link.name, sort_order: link.sort_order })),
      })),
    );
    const ids = new Set([...dishes.map((dish) => dish.id), ...links.map((link) => link.dish_id)]);
    expect(new Set(menu.map((dish) => dish.id))).toEqual(ids);
    expect(menu.find((dish) => dish.name === SOUP)?.unitPrice).toBe(1700);
    expect(menu.find((dish) => dish.name === SHRIMP)?.unitPrice).toBe(0);
    expect(sets.some((set) => set.name === "單點上湯魚翅羹")).toBe(true);
    expect(registerSetChoices(sets).map((set) => set.name)).not.toContain("單點上湯魚翅羹");
    expect(linePrice(0, 2)).toBe(0);
    expect(linePrice(1700, 2)).toBe(3400);
    expect(addonLineText({ dish_name: SHRIMP, quantity: 2, price: 0 })).toBe(`加購 ${SHRIMP} ×2 售價 0`);
    expect(addonLineText({ dish_name: SOUP, quantity: 1, price: 1700 })).toBe(`加購 ${SOUP} ×1 售價 1700`);
  });

  it("adds à-la-carte portions onto a set and counts them in that slot", async () => {
    const cookie = await adminCookie();
    const slot = await slotId();
    const other = await sql<{ id: string }>(
      `insert into day_slots (service_date, service_type, label, start_time, end_time)
       values ($1, 'takeout', '單點其他時段', '13:00', '13:30')
       returning id`,
      [DATE],
    );
    const otherId = other[0].id;
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
    const shrimpLine = order.addons.find((addon) => addon.dish_name === SHRIMP);
    const soupLine = order.addons.find((addon) => addon.dish_name === SOUP);
    expect(shrimpLine).toMatchObject({ quantity: 2, price: 0, amount_paid: 0 });
    expect(soupLine).toMatchObject({ quantity: 2, price: 3400, amount_paid: 2000 });

    const listed = await GET(request("GET", cookie, "http://localhost/api/orders?q=單點加套餐"));
    const found = ((await listed.json()) as { orders: Order[] }).orders.find((item) => item.id === order.id);
    expect(found?.addons.find((addon) => addon.dish_name === SHRIMP)?.quantity).toBe(2);
    expect(addonLineText(found!.addons.find((addon) => addon.dish_name === SHRIMP)!)).toBe(
      `加購 ${SHRIMP} ×2 售價 0`,
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
    const badPhone = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "單點壞電話",
        phone: "12345",
        service_type: "takeout",
        menu_set_id: eight[0].id,
        slot_id: slot,
        alacarte: [{ dish_id: shrimp[0].id, quantity: 1 }],
      }),
    );
    expect(badPhone.status).toBe(400);
    const stored = await sql<{ id: string }>(
      "select id from order_items where customer_name in ('單點壞數量', '單點壞電話')",
    );
    expect(stored).toEqual([]);
  });
});
