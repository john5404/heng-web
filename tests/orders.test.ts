import { describe, expect, it } from "vitest";
import { DELETE, PATCH } from "../src/app/api/orders/[id]/route";
import { GET, POST } from "../src/app/api/orders/route";
import { createSession, hashPassword, SESSION_COOKIE } from "../src/lib/auth";
import { sql } from "../src/lib/db";
import { isPaidInFull, remainingAmount } from "../src/lib/money";

type OrderItem = {
  id: string;
  customer_name: string;
  phone: string;
  service_type: string;
  menu_set_id: string | null;
  menu_set_name: string | null;
  slot_id: string;
  price: number;
  amount_paid: number;
  remaining: number;
  paid_in_full: boolean;
  picked_up: boolean;
};

async function ensureAdminUser(): Promise<string> {
  const existing = await sql<{ id: string }>("select id from users where username = $1", ["admin"]);
  if (existing[0]) return existing[0].id;
  const passwordHash = await hashPassword("temp-pass");
  await sql("insert into users (username, password_hash, role) values ($1, $2, 'admin')", [
    "admin",
    passwordHash,
  ]);
  const rows = await sql<{ id: string }>("select id from users where username = $1", ["admin"]);
  return rows[0].id;
}

async function adminCookie(): Promise<string> {
  const id = await ensureAdminUser();
  return `${SESSION_COOKIE}=${createSession({ id })}`;
}

async function roleCookie(username: string, role: "viewer" | "pickup"): Promise<string> {
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
  return `${SESSION_COOKIE}=${createSession({ id: rows[0].id })}`;
}

function request(method: string, cookie: string | undefined, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function slotId(serviceType: "takeout" | "dine_in" = "takeout"): Promise<string> {
  const label = serviceType === "takeout" ? "外場測試時段" : "外場測試內用";
  const existing = await sql<{ id: string }>(
    "select id from day_slots where label = $1 limit 1",
    [label],
  );
  if (existing[0]) return existing[0].id;
  const [start, end] = serviceType === "takeout" ? ["14:00", "14:30"] : ["18:00", "21:00"];
  const rows = await sql<{ id: string }>(
    `insert into day_slots (service_date, service_type, label, start_time, end_time)
     values ('2027-02-05', $1, $2, $3, $4)
     returning id`,
    [serviceType, label, start, end],
  );
  return rows[0].id;
}

async function menuSet(name: string): Promise<{ id: string; price: number }> {
  const rows = await sql<{ id: string; price: number }>(
    "select id, price from menu_sets where name = $1",
    [name],
  );
  if (!rows[0]) throw new Error(`missing menu set ${name}`);
  return rows[0];
}

describe("orders API", () => {
  it("returns every independent item that shares a customer name", async () => {
    const cookie = await adminCookie();
    const takeout = await slotId("takeout");
    const dineIn = await slotId("dine_in");
    const wan = await menuSet("萬元套餐");
    const ba = await menuSet("八千套餐");
    const name = "林小安";

    const first = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: name,
        phone: "0912000111",
        service_type: "takeout",
        menu_set_id: wan.id,
        slot_id: takeout,
        price: wan.price,
      }),
    );
    const second = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: name,
        phone: "0912000111",
        service_type: "dine_in",
        menu_set_id: ba.id,
        slot_id: dineIn,
        price: ba.price,
      }),
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = (await first.json()) as OrderItem;
    const b = (await second.json()) as OrderItem;
    expect(a.id).not.toBe(b.id);

    const listed = await GET(
      request("GET", cookie, `http://localhost/api/orders?q=${encodeURIComponent(name)}`),
    );
    expect(listed.status).toBe(200);
    const orders = ((await listed.json()) as { orders: OrderItem[] }).orders;
    const ids = orders.map((order) => order.id);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(orders.filter((order) => order.customer_name === name).length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(ids.length);

    const audits = await sql<{ action: string }>(
      "select action from audit_logs where entity = $1 and entity_id = $2",
      ["order_items", a.id],
    );
    expect(audits.map((row) => row.action)).toContain("create");
  });

  it("marks paid in full when amount paid is at least the price", async () => {
    const cookie = await adminCookie();
    const slot = await slotId();
    const ba = await menuSet("八千套餐");
    const created = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "付清客人",
        phone: "0912000222",
        service_type: "takeout",
        menu_set_id: ba.id,
        slot_id: slot,
        price: 8000,
        amount_paid: 2000,
      }),
    );
    expect(created.status).toBe(201);
    const partial = (await created.json()) as OrderItem;
    expect(partial.paid_in_full).toBe(false);
    expect(partial.remaining).toBe(remainingAmount(8000, 2000));
    expect(partial.paid_in_full).toBe(isPaidInFull(8000, 2000));

    const exact = await PATCH(
      request("PATCH", cookie, `http://localhost/api/orders/${partial.id}`, { amount_paid: 8000 }),
      { params: Promise.resolve({ id: partial.id }) },
    );
    expect(exact.status).toBe(200);
    const paid = (await exact.json()) as OrderItem;
    expect(paid.amount_paid).toBe(8000);
    expect(paid.remaining).toBe(0);
    expect(paid.paid_in_full).toBe(true);

    const over = await PATCH(
      request("PATCH", cookie, `http://localhost/api/orders/${partial.id}`, { amount_paid: 9000 }),
      { params: Promise.resolve({ id: partial.id }) },
    );
    const overpaid = (await over.json()) as OrderItem;
    expect(over.status).toBe(200);
    expect(overpaid.paid_in_full).toBe(true);
    expect(overpaid.remaining).toBe(remainingAmount(8000, 9000));

    const audits = await sql<{ action: string }>(
      "select action from audit_logs where entity = $1 and entity_id = $2 order by created_at",
      ["order_items", partial.id],
    );
    expect(audits.map((row) => row.action)).toEqual(expect.arrayContaining(["create", "update"]));
  });

  it("defaults amount_paid to 2000 when create omits it", async () => {
    const cookie = await adminCookie();
    const slot = await slotId();
    const set = await menuSet("六千六套餐");
    const response = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "預設訂金",
        phone: "0912000333",
        service_type: "takeout",
        menu_set_id: set.id,
        slot_id: slot,
        price: 6600,
      }),
    );
    expect(response.status).toBe(201);
    const order = (await response.json()) as OrderItem;
    expect(order.amount_paid).toBe(2000);
    expect(order.remaining).toBe(remainingAmount(6600, 2000));
    expect(order.paid_in_full).toBe(false);

    const stored = await sql<{ amount_paid: number }>(
      "select amount_paid from order_items where id = $1",
      [order.id],
    );
    expect(Number(stored[0]?.amount_paid)).toBe(2000);
  });

  it("rejects non-admin delete with 403 and keeps the row", async () => {
    const admin = await adminCookie();
    const slot = await slotId();
    const soup = await menuSet("單點上湯魚翅羹");
    const created = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "不可刪",
        phone: "0912000444",
        service_type: "takeout",
        menu_set_id: soup.id,
        slot_id: slot,
        price: 1700,
      }),
    );
    const order = (await created.json()) as OrderItem;

    for (const [username, role] of [
      ["orders_viewer", "viewer"],
      ["orders_pickup", "pickup"],
    ] as const) {
      const cookie = await roleCookie(username, role);
      const response = await DELETE(
        request("DELETE", cookie, `http://localhost/api/orders/${order.id}`),
        { params: Promise.resolve({ id: order.id }) },
      );
      expect(response.status).toBe(403);
    }

    const row = await sql<{ deleted_at: string | null }>(
      "select deleted_at from order_items where id = $1",
      [order.id],
    );
    expect(row[0]?.deleted_at ?? null).toBeNull();

    const removed = await DELETE(
      request("DELETE", admin, `http://localhost/api/orders/${order.id}`),
      { params: Promise.resolve({ id: order.id }) },
    );
    expect(removed.status).toBe(200);
    const after = await sql<{ deleted_at: string | null }>(
      "select deleted_at from order_items where id = $1",
      [order.id],
    );
    expect(after[0]?.deleted_at).toBeTruthy();
    const audits = await sql<{ action: string }>(
      "select action from audit_logs where entity = $1 and entity_id = $2",
      ["order_items", order.id],
    );
    expect(audits.map((row) => row.action)).toContain("delete");

    const listed = await GET(
      request("GET", admin, "http://localhost/api/orders?q=%E4%B8%8D%E5%8F%AF%E5%88%AA"),
    );
    const orders = ((await listed.json()) as { orders: OrderItem[] }).orders;
    expect(orders.find((item) => item.id === order.id)).toBeUndefined();
  });

  it("rejects a priced create that has no menu set", async () => {
    const cookie = await adminCookie();
    const slot = await slotId();
    const response = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "無級距",
        phone: "0912000555",
        service_type: "takeout",
        menu_set_id: null,
        slot_id: slot,
        price: 8000,
      }),
    );
    expect(response.status).toBe(400);
    const stored = await sql<{ id: string }>(
      "select id from order_items where customer_name = $1",
      ["無級距"],
    );
    expect(stored).toEqual([]);
  });

  it("rejects create and update when service type does not match the slot", async () => {
    const cookie = await adminCookie();
    const takeout = await slotId("takeout");
    const dineIn = await slotId("dine_in");
    const set = await menuSet("萬元套餐");
    const mismatch = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "時段不符",
        phone: "0912000666",
        service_type: "dine_in",
        menu_set_id: set.id,
        slot_id: takeout,
        price: set.price,
      }),
    );
    expect(mismatch.status).toBe(400);

    const created = await POST(
      request("POST", cookie, "http://localhost/api/orders", {
        customer_name: "時段相符",
        phone: "0912000666",
        service_type: "takeout",
        menu_set_id: set.id,
        slot_id: takeout,
        price: set.price,
      }),
    );
    expect(created.status).toBe(201);
    const order = (await created.json()) as OrderItem;

    const patched = await PATCH(
      request("PATCH", cookie, `http://localhost/api/orders/${order.id}`, { service_type: "dine_in" }),
      { params: Promise.resolve({ id: order.id }) },
    );
    expect(patched.status).toBe(400);
    const moved = await PATCH(
      request("PATCH", cookie, `http://localhost/api/orders/${order.id}`, { slot_id: dineIn }),
      { params: Promise.resolve({ id: order.id }) },
    );
    expect(moved.status).toBe(400);

    const stored = await sql<{ service_type: string; slot_id: string }>(
      "select service_type, slot_id from order_items where id = $1",
      [order.id],
    );
    expect(stored[0]).toMatchObject({ service_type: "takeout", slot_id: takeout });

    const aligned = await PATCH(
      request("PATCH", cookie, `http://localhost/api/orders/${order.id}`, {
        service_type: "dine_in",
        slot_id: dineIn,
      }),
      { params: Promise.resolve({ id: order.id }) },
    );
    expect(aligned.status).toBe(200);
    const after = (await aligned.json()) as OrderItem;
    expect(after.service_type).toBe("dine_in");
    expect(after.slot_id).toBe(dineIn);
  });
});
