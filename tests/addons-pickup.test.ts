import { describe, expect, it } from "vitest";
import { DELETE, PATCH } from "../src/app/api/orders/[id]/route";
import { GET, POST } from "../src/app/api/orders/route";
import { createSession, hashPassword, SESSION_COOKIE } from "../src/lib/auth";
import { sql } from "../src/lib/db";
import { remainingAmount } from "../src/lib/money";

type AddonItem = {
  id: string;
  parent_order_item_id: string;
  dish_id: string;
  dish_name: string;
  price: number;
  amount_paid: number;
  remaining: number;
  paid_in_full: boolean;
  picked_up: boolean;
  quantity: number;
};

type OrderItem = {
  id: string;
  customer_name: string;
  price: number;
  total: number;
  amount_paid: number;
  remaining: number;
  paid_in_full: boolean;
  picked_up: boolean;
  menu_set_name: string | null;
  addons?: AddonItem[];
};

const SOUP = "上湯魚翅羹";

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

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function menuSet(name: string): Promise<{ id: string; price: number }> {
  const rows = await sql<{ id: string; price: number }>(
    "select id, price from menu_sets where name = $1",
    [name],
  );
  if (!rows[0]) throw new Error(`missing menu set ${name}`);
  return rows[0];
}

async function slotId(): Promise<string> {
  const existing = await sql<{ id: string }>(
    "select id from day_slots where label = $1 limit 1",
    ["加購測試時段"],
  );
  if (existing[0]) return existing[0].id;
  const rows = await sql<{ id: string }>(
    `insert into day_slots (service_date, service_type, label, start_time, end_time)
     values ('2027-02-06', 'takeout', '加購測試時段', '15:00', '15:30')
     returning id`,
  );
  return rows[0].id;
}

async function auditIds(entityId: string): Promise<string[]> {
  const rows = await sql<{ id: string }>(
    "select id from audit_logs where entity_id = $1",
    [entityId],
  );
  return rows.map((row) => row.id);
}

describe("addons and pickup role", () => {
  it("lets pickup mark picked_up and rejects amount_paid without a success audit", async () => {
    const admin = await adminCookie();
    const pickup = await roleCookie("addon_pickup", "pickup");
    const viewer = await roleCookie("addon_viewer", "viewer");
    const slot = await slotId();
    const ba = await menuSet("八千套餐");
    const created = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "領餐測試",
        phone: "0912111000",
        service_type: "takeout",
        menu_set_id: ba.id,
        slot_id: slot,
        price: 8000,
        amount_paid: 2000,
      }),
    );
    expect(created.status).toBe(201);
    const order = (await created.json()) as OrderItem;

    const beforePay = await auditIds(order.id);
    const pay = await PATCH(
      request("PATCH", pickup, `http://localhost/api/orders/${order.id}`, { amount_paid: 8000 }),
      params(order.id),
    );
    expect(pay.status).toBe(403);
    expect(await auditIds(order.id)).toEqual(beforePay);
    const storedPay = await sql<{ amount_paid: number; picked_up: boolean }>(
      "select amount_paid, picked_up from order_items where id = $1",
      [order.id],
    );
    expect(Number(storedPay[0].amount_paid)).toBe(2000);
    expect(storedPay[0].picked_up).toBe(false);

    const mixed = await PATCH(
      request("PATCH", pickup, `http://localhost/api/orders/${order.id}`, {
        picked_up: true,
        amount_paid: 8000,
      }),
      params(order.id),
    );
    expect(mixed.status).toBe(403);
    expect(await auditIds(order.id)).toEqual(beforePay);
    const storedMixed = await sql<{ amount_paid: number; picked_up: boolean }>(
      "select amount_paid, picked_up from order_items where id = $1",
      [order.id],
    );
    expect(Number(storedMixed[0].amount_paid)).toBe(2000);
    expect(storedMixed[0].picked_up).toBe(false);

    const viewerMark = await PATCH(
      request("PATCH", viewer, `http://localhost/api/orders/${order.id}`, { picked_up: true }),
      params(order.id),
    );
    expect(viewerMark.status).toBe(403);
    expect(await auditIds(order.id)).toEqual(beforePay);

    const marked = await PATCH(
      request("PATCH", pickup, `http://localhost/api/orders/${order.id}`, { picked_up: true }),
      params(order.id),
    );
    expect(marked.status).toBe(200);
    const after = (await marked.json()) as OrderItem;
    expect(after.picked_up).toBe(true);
    expect(after.amount_paid).toBe(2000);
    expect(after.remaining).toBe(remainingAmount(8000, 2000));

    const audits = await sql<{ action: string; entity: string }>(
      "select action, entity from audit_logs where entity_id = $1 order by created_at",
      [order.id],
    );
    expect(audits.map((row) => row.action)).toEqual(["create", "update"]);
    expect(audits.every((row) => row.entity === "order_items")).toBe(true);
    const row = await sql<{ amount_paid: number; picked_up: boolean }>(
      "select amount_paid, picked_up from order_items where id = $1",
      [order.id],
    );
    expect(row[0].picked_up).toBe(true);
    expect(Number(row[0].amount_paid)).toBe(2000);

    const removed = await DELETE(
      request("DELETE", pickup, `http://localhost/api/orders/${order.id}`),
      params(order.id),
    );
    expect(removed.status).toBe(403);
    const still = await sql<{ deleted_at: string | null }>(
      "select deleted_at from order_items where id = $1",
      [order.id],
    );
    expect(still[0].deleted_at).toBeNull();
    const actions = await sql<{ action: string }>(
      "select action from audit_logs where entity_id = $1",
      [order.id],
    );
    expect(actions.map((item) => item.action)).not.toContain("delete");
  });

  it("rolls a 單點 line into the order total without a second deposit", async () => {
    const admin = await adminCookie();
    const slot = await slotId();
    const wan = await menuSet("萬元套餐");
    const parentRes = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "加購母項",
        phone: "0912111222",
        service_type: "takeout",
        menu_set_id: wan.id,
        slot_id: slot,
        price: 10000,
        amount_paid: 2000,
      }),
    );
    expect(parentRes.status).toBe(201);
    const parent = (await parentRes.json()) as OrderItem;
    expect(parent.remaining).toBe(8000);
    expect(parent.total).toBe(10000);

    const addonRes = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        parent_order_item_id: parent.id,
        price: 1700,
        amount_paid: 500,
      }),
    );
    expect(addonRes.status).toBe(201);
    const addon = (await addonRes.json()) as AddonItem;
    expect(addon.parent_order_item_id).toBe(parent.id);
    expect(addon.dish_name).toBe(SOUP);
    expect(addon.price).toBe(1700);
    expect(addon.amount_paid).toBe(0);
    expect(addon.picked_up).toBe(false);

    const listed = await GET(
      request("GET", admin, "http://localhost/api/orders?q=%E5%8A%A0%E8%B3%BC%E6%AF%8D%E9%A0%85"),
    );
    expect(listed.status).toBe(200);
    const orders = ((await listed.json()) as { orders: OrderItem[] }).orders;
    const found = orders.find((order) => order.id === parent.id);
    expect(found?.amount_paid).toBe(2000);
    expect(found?.total).toBe(11700);
    expect(found?.remaining).toBe(9700);
    expect(found?.paid_in_full).toBe(false);
    expect(found?.addons).toHaveLength(1);
    expect(found?.addons?.[0].id).toBe(addon.id);
    expect(found?.addons?.[0].amount_paid).toBe(0);

    const parentAfterAddon = await sql<{ amount_paid: number; price: number }>(
      "select amount_paid, price from order_items where id = $1",
      [parent.id],
    );
    expect(Number(parentAfterAddon[0].amount_paid)).toBe(2000);
    expect(Number(parentAfterAddon[0].price)).toBe(10000);

    const paidParent = await PATCH(
      request("PATCH", admin, `http://localhost/api/orders/${parent.id}`, { amount_paid: 11700 }),
      params(parent.id),
    );
    expect(paidParent.status).toBe(200);
    const parentPaid = (await paidParent.json()) as OrderItem;
    expect(parentPaid.total).toBe(11700);
    expect(parentPaid.remaining).toBe(0);
    expect(parentPaid.paid_in_full).toBe(true);
    expect(parentPaid.addons?.[0].amount_paid).toBe(0);

    const addonRow = await sql<{ amount_paid: number }>(
      "select amount_paid from addons where id = $1",
      [addon.id],
    );
    expect(Number(addonRow[0].amount_paid)).toBe(0);

    const addonAudits = await sql<{ action: string; entity: string }>(
      "select action, entity from audit_logs where entity_id = $1",
      [addon.id],
    );
    expect(addonAudits.map((row) => `${row.entity}:${row.action}`)).toEqual(["addons:create"]);
  });

  it("sells 上湯魚翅羹 from the 單點 list at 1700 per portion, or as an addon", async () => {
    const admin = await adminCookie();
    const pickup = await roleCookie("addon_pickup", "pickup");
    const slot = await slotId();
    const mid = await menuSet("六千六套餐");
    const soupPrice = await sql<{ alacarte_price: number }>(
      "select alacarte_price from dishes where name = $1",
      [SOUP],
    );
    expect(Number(soupPrice[0].alacarte_price)).toBe(1700);
    const soupDish = await sql<{ id: string }>("select id from dishes where name = $1", [SOUP]);

    const alone = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "單點魚翅",
        phone: "0912111333",
        service_type: "takeout",
        menu_set_id: mid.id,
        slot_id: slot,
        alacarte: [{ dish_id: soupDish[0].id, quantity: 1 }],
      }),
    );
    expect(alone.status).toBe(201);
    const standalone = (await alone.json()) as OrderItem;
    expect(standalone.menu_set_name).toBe("六千六套餐");
    expect(standalone.total).toBe(8300);
    expect(standalone.amount_paid).toBe(2000);
    expect(standalone.remaining).toBe(6300);
    expect(standalone.addons?.find((addon) => addon.dish_name === SOUP)).toMatchObject({
      quantity: 1,
      price: 1700,
      amount_paid: 0,
    });

    const parentRes = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "單點魚翅",
        phone: "0912111333",
        service_type: "takeout",
        menu_set_id: mid.id,
        slot_id: slot,
        price: 6600,
      }),
    );
    const parent = (await parentRes.json()) as OrderItem;
    expect(parent.amount_paid).toBe(2000);
    expect(parent.remaining).toBe(remainingAmount(6600, 2000));

    const cheap = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "低價滿付",
        phone: "0912111444",
        service_type: "takeout",
        menu_set_id: mid.id,
        slot_id: slot,
        price: 1700,
      }),
    );
    const cheapOrder = (await cheap.json()) as OrderItem;
    expect(cheapOrder.amount_paid).toBe(1700);
    expect(cheapOrder.paid_in_full).toBe(true);

    const over = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "明示超收",
        phone: "0912111555",
        service_type: "takeout",
        menu_set_id: mid.id,
        slot_id: slot,
        price: 1700,
        amount_paid: 2000,
      }),
    );
    const overpaid = (await over.json()) as OrderItem;
    expect(overpaid.amount_paid).toBe(2000);
    expect(overpaid.paid_in_full).toBe(true);

    const addonRes = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        parent_order_item_id: parent.id,
      }),
    );
    expect(addonRes.status).toBe(201);
    const addon = (await addonRes.json()) as AddonItem;
    expect(addon.dish_name).toBe(SOUP);
    expect(addon.price).toBe(1700);
    expect(addon.amount_paid).toBe(0);

    const listed = await GET(
      request("GET", admin, "http://localhost/api/orders?q=%E5%96%AE%E9%BB%9E%E9%AD%9A%E7%BF%85"),
    );
    const orders = ((await listed.json()) as { orders: OrderItem[] }).orders.filter(
      (order) => order.customer_name === "單點魚翅",
    );
    expect(orders.map((order) => order.id)).toEqual(expect.arrayContaining([standalone.id, parent.id]));
    const withAddon = orders.find((order) => order.id === parent.id);
    expect(withAddon?.total).toBe(8300);
    expect(withAddon?.remaining).toBe(6300);
    expect(withAddon?.addons?.map((item) => item.id)).toEqual([addon.id]);
    expect(withAddon?.addons?.[0].amount_paid).toBe(0);

    const before = await auditIds(addon.id);
    const denied = await PATCH(
      request("PATCH", pickup, `http://localhost/api/orders/${addon.id}`, { amount_paid: 0 }),
      params(addon.id),
    );
    expect(denied.status).toBe(403);
    expect(await auditIds(addon.id)).toEqual(before);
    const unpaid = await sql<{ amount_paid: number }>("select amount_paid from addons where id = $1", [
      addon.id,
    ]);
    expect(Number(unpaid[0].amount_paid)).toBe(0);

    const picked = await PATCH(
      request("PATCH", pickup, `http://localhost/api/orders/${addon.id}`, { picked_up: true }),
      params(addon.id),
    );
    expect(picked.status).toBe(200);
    const pickedAddon = (await picked.json()) as AddonItem;
    expect(pickedAddon.picked_up).toBe(true);
    expect(pickedAddon.amount_paid).toBe(0);
    const parentStill = await sql<{ picked_up: boolean }>(
      "select picked_up from order_items where id = $1",
      [parent.id],
    );
    expect(parentStill[0].picked_up).toBe(false);

    const created = await POST(
      request("POST", pickup, "http://localhost/api/orders", {
        parent_order_item_id: parent.id,
      }),
    );
    expect(created.status).toBe(403);
  });
});
