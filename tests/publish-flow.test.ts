import { describe, expect, it } from "vitest";
import { GET as auditGet } from "../src/app/api/audit/route";
import { GET as kitchenGet } from "../src/app/api/kitchen/route";
import { PATCH } from "../src/app/api/orders/[id]/route";
import { POST } from "../src/app/api/orders/route";
import { createSession, hashPassword, SESSION_COOKIE } from "../src/lib/auth";
import { sql } from "../src/lib/db";

const DATE = "2027-02-20";
const DISH = "白灼蒜味蝦";

type OrderItem = {
  id: string;
  price: number;
  amount_paid: number;
  remaining: number;
  picked_up: boolean;
};

type AuditLog = {
  action: string;
  entity: string;
  entity_id: string | null;
  before: { amount_paid?: number; picked_up?: boolean } | null;
  after: { amount_paid?: number; picked_up?: boolean } | null;
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

async function pickupCookie(): Promise<string> {
  const username = "flow-pickup";
  const existing = await sql<{ id: string }>("select id from users where username = $1", [username]);
  if (!existing[0]) {
    const passwordHash = await hashPassword("temp-pass");
    await sql("insert into users (username, password_hash, role) values ($1, $2, 'pickup')", [
      username,
      passwordHash,
    ]);
  }
  const rows = await sql<{ id: string }>("select id from users where username = $1", [username]);
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

describe("publish flow", () => {
  it("creates an order, changes the deposit, counts kitchen portions, marks pickup, and writes audit", async () => {
    const admin = await adminCookie();
    const slotRows = await sql<{ id: string }>(
      `insert into day_slots (service_date, service_type, label, start_time, end_time)
       values ($1, 'takeout', '發佈走查時段', '16:00', '16:30')
       returning id`,
      [DATE],
    );
    const slotId = slotRows[0].id;
    const sets = await sql<{ id: string; price: number }>(
      "select id, price from menu_sets where name = $1",
      ["萬元套餐"],
    );

    const createdRes = await POST(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "走查客人",
        phone: "0912000888",
        service_type: "takeout",
        menu_set_id: sets[0].id,
        slot_id: slotId,
      }),
    );
    expect(createdRes.status).toBe(201);
    const created = (await createdRes.json()) as OrderItem;
    expect(created.amount_paid).toBe(2000);

    const paidRes = await PATCH(
      request("PATCH", admin, `http://localhost/api/orders/${created.id}`, { amount_paid: 5000 }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(paidRes.status).toBe(200);
    const paid = (await paidRes.json()) as OrderItem;
    expect(paid.amount_paid).toBe(5000);
    expect(paid.remaining).toBe(created.price - 5000);

    const kitchenRes = await kitchenGet(
      request("GET", admin, `http://localhost/api/kitchen?date=${DATE}&slot_id=${encodeURIComponent(slotId)}`),
    );
    expect(kitchenRes.status).toBe(200);
    const totals = ((await kitchenRes.json()) as { totals: { dishName: string; qty: number }[] }).totals;
    expect(totals.find((row) => row.dishName === DISH)?.qty).toBe(1);

    const pickup = await pickupCookie();
    const pickedRes = await PATCH(
      request("PATCH", pickup, `http://localhost/api/orders/${created.id}`, { picked_up: true }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(pickedRes.status).toBe(200);
    expect(((await pickedRes.json()) as OrderItem).picked_up).toBe(true);

    const afterPickup = await kitchenGet(
      request("GET", admin, `http://localhost/api/kitchen?date=${DATE}&slot_id=${encodeURIComponent(slotId)}`),
    );
    const still = ((await afterPickup.json()) as { totals: { dishName: string; qty: number }[] }).totals;
    expect(still.find((row) => row.dishName === DISH)?.qty).toBe(1);

    const auditRes = await auditGet(request("GET", admin, "http://localhost/api/audit?limit=200"));
    expect(auditRes.status).toBe(200);
    const logs = ((await auditRes.json()) as { logs: AuditLog[] }).logs.filter(
      (log) => log.entity_id === created.id && log.entity === "order_items",
    );
    expect(logs.map((log) => log.action).sort()).toEqual(["create", "update", "update"]);
    expect(logs.some((log) => log.action === "update" && log.after?.amount_paid === 5000)).toBe(true);
    expect(logs.some((log) => log.action === "update" && log.after?.picked_up === true)).toBe(true);
  });
});
