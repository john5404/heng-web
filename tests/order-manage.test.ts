import { describe, expect, it } from "vitest";
import { GET as listOrders } from "../src/app/api/orders/route";
import { POST } from "../src/app/api/orders/route";
import { DELETE, PATCH } from "../src/app/api/orders/[id]/route";
import { createSession, hashPassword, SESSION_COOKIE } from "../src/lib/auth";
import { sql } from "../src/lib/db";
import { orderTotal, remainingAmount } from "../src/lib/money";

const DATE = "2027-02-18";

type Order = {
  id: string;
  customer_name: string;
  phone: string;
  slot_id: string;
  menu_set_id: string | null;
  price: number;
  amount_paid: number;
  total: number;
  remaining: number;
  paid_in_full: boolean;
  note: string | null;
  addons: { id: string; dish_id: string; dish_name: string; quantity: number; price: number }[];
};

async function ensureUser(username: string, role: "admin" | "pickup" | "viewer"): Promise<string> {
  const existing = await sql<{ id: string }>("select id from users where username = $1", [username]);
  if (!existing[0]) {
    const passwordHash = await hashPassword("temp-pass");
    await sql("insert into users (username, password_hash, role) values ($1, $2, $3)", [
      username,
      passwordHash,
      role,
    ]);
  }
  const rows = await sql<{ id: string }>("select id from users where username = $1", [username]);
  return `${SESSION_COOKIE}=${await createSession({ id: rows[0].id })}`;
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

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function slot(label: string, serviceType: "takeout" | "dine_in"): Promise<string> {
  const existing = await sql<{ id: string }>("select id from day_slots where label = $1 limit 1", [label]);
  if (existing[0]) return existing[0].id;
  const rows = await sql<{ id: string }>(
    `insert into day_slots (service_date, service_type, label, start_time, end_time)
     values ($1, $2, $3, '12:00', '12:30')
     returning id`,
    [DATE, serviceType, label],
  );
  return rows[0].id;
}

async function idOf(table: "menu_sets" | "dishes", name: string): Promise<string> {
  const rows = await sql<{ id: string }>(`select id from ${table} where name = $1`, [name]);
  return rows[0].id;
}

describe("order management", () => {
  it("lets an admin edit one order and recalculate its total without resetting the deposit", async () => {
    const admin = await ensureUser("admin", "admin");
    const from = await slot("管理原時段", "takeout");
    const to = await slot("管理新時段", "dine_in");
    const wan = await idOf("menu_sets", "萬元套餐");
    const eight = await idOf("menu_sets", "八千套餐");
    const soup = await idOf("dishes", "上湯魚翅羹");
    const shrimp = await idOf("dishes", "白灼蒜味蝦");

    const created = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "管理原名",
        phone: "0912000111",
        service_type: "takeout",
        menu_set_id: wan,
        slot_id: from,
        alacarte: [{ dish_id: soup, quantity: 1 }],
        amount_paid: 3000,
      }),
    );
    expect(created.status).toBe(201);
    const order = (await created.json()) as Order;
    const soupLine = order.addons.find((line) => line.dish_id === soup);
    expect(soupLine?.price).toBe(1700);

    await sql("update dishes set alacarte_price = 9000 where id = $1", [soup]);
    await sql("update dishes set alacarte_price = 500 where id = $1", [shrimp]);

    let saved: Response;
    try {
    saved = await PATCH(
      request("PATCH", admin, `http://localhost/api/orders/${order.id}`, {
        customer_name: "管理新名",
        phone: "02-23456789",
        slot_id: to,
        service_type: "dine_in",
        menu_set_id: eight,
        price: 8000,
        amount_paid: 3000,
        note: "改備註",
        alacarte: [
          { id: soupLine?.id, dish_id: soup, quantity: 2 },
          { dish_id: shrimp, quantity: 3 },
        ],
      }),
      params(order.id),
    );
    expect(saved.status).toBe(200);
    const after = (await saved.json()) as Order;
    const keptSoup = after.addons.find((line) => line.dish_id === soup);
    const addedShrimp = after.addons.find((line) => line.dish_id === shrimp);
    expect(after.customer_name).toBe("管理新名");
    expect(after.phone).toBe("02-23456789");
    expect(after.slot_id).toBe(to);
    expect(after.menu_set_id).toBe(eight);
    expect(after.price).toBe(8000);
    expect(after.note).toBe("改備註");
    expect(keptSoup?.price).toBe(1700);
    expect(keptSoup?.quantity).toBe(2);
    expect(addedShrimp?.price).toBe(500);
    expect(addedShrimp?.quantity).toBe(3);
    const total = orderTotal(8000, [
      { price: 1700, quantity: 2 },
      { price: 500, quantity: 3 },
    ]);
    expect(after.total).toBe(total);
    expect(after.amount_paid).toBe(3000);
    expect(after.remaining).toBe(remainingAmount(total, 3000));
    expect(after.paid_in_full).toBe(false);
    } finally {
      await sql("update dishes set alacarte_price = 1700 where id = $1", [soup]);
      await sql("update dishes set alacarte_price = 0 where id = $1", [shrimp]);
    }
  });

  it("rejects an order that has neither a set nor a 單點 line", async () => {
    const admin = await ensureUser("admin", "admin");
    const from = await slot("管理原時段", "takeout");
    const wan = await idOf("menu_sets", "萬元套餐");
    const created = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "不可清空",
        phone: "0912000222",
        service_type: "takeout",
        menu_set_id: wan,
        slot_id: from,
      }),
    );
    const order = (await created.json()) as Order;
    const cleared = await PATCH(
      request("PATCH", admin, `http://localhost/api/orders/${order.id}`, {
        menu_set_id: null,
        alacarte: [],
      }),
      params(order.id),
    );
    expect(cleared.status).toBe(400);
    expect(((await cleared.json()) as { error: string }).error).toBe("請至少加入一道單點");
    const still = await sql<{ menu_set_id: string }>("select menu_set_id from order_items where id = $1", [order.id]);
    expect(still[0].menu_set_id).toBe(wan);
  });

  it("lets pickup and viewer read a slot list but not edit or delete", async () => {
    const admin = await ensureUser("admin", "admin");
    const pickup = await ensureUser("manage_pickup", "pickup");
    const viewer = await ensureUser("manage_viewer", "viewer");
    const from = await slot("管理原時段", "takeout");
    const wan = await idOf("menu_sets", "萬元套餐");
    const created = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "只能看",
        phone: "0912000333",
        service_type: "takeout",
        menu_set_id: wan,
        slot_id: from,
      }),
    );
    const order = (await created.json()) as Order;

    const listed = await listOrders(request("GET", pickup, `http://localhost/api/orders?slot=${from}`));
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { role: string; orders: { id: string }[] };
    expect(body.role).toBe("pickup");
    expect(body.orders.some((row) => row.id === order.id)).toBe(true);

    const edited = await PATCH(
      request("PATCH", pickup, `http://localhost/api/orders/${order.id}`, { customer_name: "不該改" }),
      params(order.id),
    );
    expect(edited.status).toBe(403);
    const removed = await DELETE(request("DELETE", viewer, `http://localhost/api/orders/${order.id}`), params(order.id));
    expect(removed.status).toBe(403);
  });

  it("soft-deletes an order so the slot list no longer returns it", async () => {
    const admin = await ensureUser("admin", "admin");
    const from = await slot("管理原時段", "takeout");
    const soup = await idOf("dishes", "上湯魚翅羹");
    const created = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "即將刪除",
        phone: "0912000444",
        service_type: "takeout",
        slot_id: from,
        alacarte: [{ dish_id: soup, quantity: 1 }],
      }),
    );
    const order = (await created.json()) as Order;
    const removed = await DELETE(request("DELETE", admin, `http://localhost/api/orders/${order.id}`), params(order.id));
    expect(removed.status).toBe(200);
    const listed = await listOrders(request("GET", admin, `http://localhost/api/orders?slot=${from}`));
    const body = (await listed.json()) as { orders: { id: string }[] };
    expect(body.orders.some((row) => row.id === order.id)).toBe(false);
    const row = await sql<{ deleted_at: string | null }>("select deleted_at from order_items where id = $1", [order.id]);
    expect(row[0].deleted_at).not.toBeNull();
  });
});
