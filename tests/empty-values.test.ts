import { describe, expect, it } from "vitest";
import { POST as createOrder, POST } from "../src/app/api/orders/route";
import { PATCH as patchOrder } from "../src/app/api/orders/[id]/route";
import { PATCH as patchMenu, POST as postMenu } from "../src/app/api/settings/menu/route";
import { createSession, hashPassword, SESSION_COOKIE } from "../src/lib/auth";
import { sql } from "../src/lib/db";
import { EMPTY_ALACARTE_PRICE, EMPTY_PAID, EMPTY_QUANTITY, EMPTY_SET_PRICE } from "../src/lib/numbers";

async function adminCookie(): Promise<string> {
  const existing = await sql<{ id: string }>("select id from users where username = $1", ["admin"]);
  if (!existing[0]) {
    const passwordHash = await hashPassword("temp-pass");
    await sql("insert into users (username, password_hash, role) values ($1, $2, 'admin')", ["admin", passwordHash]);
  }
  const rows = await sql<{ id: string }>("select id from users where username = $1", ["admin"]);
  return `${SESSION_COOKIE}=${await createSession({ id: rows[0].id })}`;
}

function request(method: string, cookie: string, url: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function slotId(): Promise<string> {
  const existing = await sql<{ id: string }>("select id from day_slots where label = $1 limit 1", ["空值測試時段"]);
  if (existing[0]) return existing[0].id;
  const rows = await sql<{ id: string }>(
    `insert into day_slots (service_date, service_type, label, start_time, end_time)
     values ('2027-02-22', 'takeout', '空值測試時段', '11:00', '11:30')
     returning id`,
  );
  return rows[0].id;
}

describe("empty numeric fields", () => {
  it("rejects a cleared set price or deposit and still allows a 單點-only order with no set price", async () => {
    const cookie = await adminCookie();
    const slot = await slotId();
    const wan = (await sql<{ id: string }>("select id from menu_sets where name = $1", ["萬元套餐"]))[0].id;
    const soup = (await sql<{ id: string }>("select id from dishes where name = $1", ["上湯魚翅羹"]))[0].id;

    const created = await createOrder(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "空值套餐",
        phone: "0912000888",
        service_type: "takeout",
        menu_set_id: wan,
        slot_id: slot,
        price: 10000,
        amount_paid: 2000,
      }),
    );
    expect(created.status).toBe(201);
    const order = (await created.json()) as { id: string; price: number; amount_paid: number };

    const clearedPrice = await patchOrder(
      request("PATCH", cookie, `http://localhost/api/orders/${order.id}`, { price: "" }),
      params(order.id),
    );
    expect(clearedPrice.status).toBe(400);
    expect(((await clearedPrice.json()) as { error: string }).error).toBe(EMPTY_SET_PRICE);

    const clearedPaid = await patchOrder(
      request("PATCH", cookie, `http://localhost/api/orders/${order.id}`, { amount_paid: "" }),
      params(order.id),
    );
    expect(clearedPaid.status).toBe(400);
    expect(((await clearedPaid.json()) as { error: string }).error).toBe(EMPTY_PAID);

    const junk = await patchOrder(
      request("PATCH", cookie, `http://localhost/api/orders/${order.id}`, { price: "十二" }),
      params(order.id),
    );
    expect(junk.status).toBe(400);

    const still = await sql<{ price: number; amount_paid: number }>(
      "select price, amount_paid from order_items where id = $1",
      [order.id],
    );
    expect(Number(still[0].price)).toBe(10000);
    expect(Number(still[0].amount_paid)).toBe(2000);

    const blankSet = await createOrder(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "空售價套餐",
        phone: "0912000881",
        service_type: "takeout",
        menu_set_id: wan,
        slot_id: slot,
        price: "",
      }),
    );
    expect(blankSet.status).toBe(400);

    const alacarteOnly = await createOrder(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "純單點空售價",
        phone: "0912000882",
        service_type: "takeout",
        slot_id: slot,
        price: "",
        alacarte: [{ dish_id: soup, quantity: 1 }],
      }),
    );
    expect(alacarteOnly.status).toBe(201);
    expect(((await alacarteOnly.json()) as { price: number }).price).toBe(0);

    const blankQty = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "空數量",
        phone: "0912000883",
        service_type: "takeout",
        slot_id: slot,
        alacarte: [{ dish_id: soup, quantity: "" }],
      }),
    );
    expect(blankQty.status).toBe(400);
    expect(((await blankQty.json()) as { error: string }).error).toBe(EMPTY_QUANTITY);
  });

  it("rejects an empty 單點 price instead of storing 0", async () => {
    const cookie = await adminCookie();
    const missing = await postMenu(
      request("POST", cookie, "http://localhost/api/settings/menu", { type: "dish", name: "空價新菜", price: "" }),
    );
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toBe(EMPTY_ALACARTE_PRICE);
    const stored = await sql<{ id: string }>("select id from dishes where name = $1", ["空價新菜"]);
    expect(stored).toEqual([]);

    const shrimp = (await sql<{ id: string; alacarte_price: number }>(
      "select id, alacarte_price from dishes where name = $1",
      ["白灼蒜味蝦"],
    ))[0];
    const cleared = await patchMenu(
      request("PATCH", cookie, "http://localhost/api/settings/menu", {
        type: "dish_price",
        id: shrimp.id,
        alacarte_price: "",
      }),
    );
    expect(cleared.status).toBe(400);
    const after = await sql<{ alacarte_price: number }>("select alacarte_price from dishes where id = $1", [shrimp.id]);
    expect(Number(after[0].alacarte_price)).toBe(Number(shrimp.alacarte_price));
  });
});
