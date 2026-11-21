import { describe, expect, it } from "vitest";
import { GET as kitchenGet } from "../src/app/api/kitchen/route";
import { PATCH as menuPatch } from "../src/app/api/settings/menu/route";
import { DELETE, PATCH } from "../src/app/api/orders/[id]/route";
import { POST } from "../src/app/api/orders/route";
import { createSession, hashPassword, SESSION_COOKIE } from "../src/lib/auth";
import { sql } from "../src/lib/db";
import { dishTotalsForSlot, mergeDishTotals } from "../src/lib/kitchen";

const DATE = "2027-02-16";
const SHRIMP = "白灼蒜味蝦";
const SOUP = "上湯魚翅羹";
const REPLACEMENT = "廚房測試新菜";

type OrderItem = { id: string };

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

async function ensureSlot(label: string): Promise<string> {
  const existing = await sql<{ id: string }>("select id from day_slots where label = $1 limit 1", [label]);
  if (existing[0]) return existing[0].id;
  const rows = await sql<{ id: string }>(
    `insert into day_slots (service_date, service_type, label, start_time, end_time)
     values ($1, 'takeout', $2, '11:00', '11:30')
     returning id`,
    [DATE, label],
  );
  return rows[0].id;
}

async function setId(name: string): Promise<string> {
  const rows = await sql<{ id: string }>("select id from menu_sets where name = $1", [name]);
  return rows[0].id;
}

async function dishOnSet(menuSetId: string, name: string): Promise<string> {
  const rows = await sql<{ id: string }>(
    `select d.id from dishes d
     join set_dishes sd on sd.dish_id = d.id
     where sd.menu_set_id = $1 and d.name = $2`,
    [menuSetId, name],
  );
  return rows[0].id;
}

function qtyOf(totals: { dishName: string; qty: number }[], name: string): number {
  return totals.find((row) => row.dishName === name)?.qty ?? 0;
}

describe("kitchen dish totals", () => {
  it("merges 白灼蒜味蝦 across sets, counts addons and picked_up, drops deleted, and follows a set edit", async () => {
    const admin = await adminCookie();
    const slot = await ensureSlot("廚房測試時段");
    const other = await ensureSlot("廚房其他時段");
    const wan = await setId("萬元套餐");
    const eight = await setId("八千套餐");
    const six = await setId("六千六套餐");

    const create = async (name: string, menuSetId: string, slotId: string) => {
      const response = await POST(
        request("POST", admin, "http://localhost/api/orders", {
          customer_name: name,
          phone: "0912000000",
          service_type: "takeout",
          menu_set_id: menuSetId,
          slot_id: slotId,
        }),
      );
      expect(response.status).toBe(201);
      return (await response.json()) as OrderItem;
    };

    const wanOrder = await create("廚房萬元", wan, slot);
    const eightOrder = await create("廚房八千", eight, slot);
    await create("廚房別時段", wan, other);
    const doomed = await create("廚房刪除", six, slot);

    const picked = await PATCH(
      request("PATCH", admin, `http://localhost/api/orders/${wanOrder.id}`, { picked_up: true }),
      params(wanOrder.id),
    );
    expect(picked.status).toBe(200);

    const before = await dishTotalsForSlot(DATE, slot);
    expect(qtyOf(before, SHRIMP)).toBe(3);

    const removed = await DELETE(
      request("DELETE", admin, `http://localhost/api/orders/${doomed.id}`),
      params(doomed.id),
    );
    expect(removed.status).toBe(200);
    const afterDelete = await dishTotalsForSlot(DATE, slot);
    expect(qtyOf(afterDelete, SHRIMP)).toBe(2);
    expect(qtyOf(await dishTotalsForSlot(DATE, other), SHRIMP)).toBe(1);
    expect(await dishTotalsForSlot("2027-02-17", slot)).toEqual([]);

    const addon = await POST(
      request("POST", admin, "http://localhost/api/orders", { parent_order_item_id: wanOrder.id }),
    );
    expect(addon.status).toBe(201);
    const withAddon = await dishTotalsForSlot(DATE, slot);
    expect(qtyOf(withAddon, SOUP)).toBe(2);
    expect(qtyOf(withAddon, SHRIMP)).toBe(2);

    const shrimpId = await dishOnSet(wan, SHRIMP);
    const replaced = await menuPatch(
      request("PATCH", admin, "http://localhost/api/settings/menu", {
        type: "set_dish",
        menu_set_id: wan,
        dish_id: shrimpId,
        new_dish_name: REPLACEMENT,
      }),
    );
    expect(replaced.status).toBe(200);
    const afterEdit = await dishTotalsForSlot(DATE, slot);
    expect(qtyOf(afterEdit, SHRIMP)).toBe(1);
    expect(qtyOf(afterEdit, REPLACEMENT)).toBe(1);
    expect(qtyOf(afterEdit, SOUP)).toBe(2);

    const viewer = await roleCookie("kitchen_viewer", "viewer");
    const listed = await kitchenGet(
      request("GET", viewer, `http://localhost/api/kitchen?date=${DATE}&slot_id=${slot}`),
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      note: string;
      totals: { dishName: string; qty: number }[];
    };
    expect(body.note).toContain("備料總量");
    expect(qtyOf(body.totals, SHRIMP)).toBe(1);
    expect(qtyOf(body.totals, REPLACEMENT)).toBe(1);
    expect(qtyOf(body.totals, SOUP)).toBe(2);

    const anon = await kitchenGet(request("GET", undefined, `http://localhost/api/kitchen?date=${DATE}&slot_id=${slot}`));
    expect(anon.status).toBe(401);

    const newDish = await sql<{ id: string }>("select id from dishes where name = $1", [REPLACEMENT]);
    const restored = await menuPatch(
      request("PATCH", admin, "http://localhost/api/settings/menu", {
        type: "set_dish",
        menu_set_id: wan,
        dish_id: newDish[0].id,
        new_dish_name: SHRIMP,
      }),
    );
    expect(restored.status).toBe(200);
    expect(qtyOf(await dishTotalsForSlot(DATE, slot), SHRIMP)).toBe(2);
    expect(qtyOf(await dishTotalsForSlot(DATE, slot), REPLACEMENT)).toBe(0);
  });

  it("rejects a kitchen query without a date or slot", async () => {
    const admin = await adminCookie();
    const missing = await kitchenGet(request("GET", admin, "http://localhost/api/kitchen?date=2027-02-16"));
    expect(missing.status).toBe(400);
  });

  it("returns each selected slot and a same-day combined total", async () => {
    const admin = await adminCookie();
    const noon = await ensureSlot("廚房多選中午");
    const evening = await ensureSlot("廚房多選晚上");
    const leftOut = await ensureSlot("廚房多選未選");
    const wan = await setId("萬元套餐");

    const create = async (name: string, slotId: string) => {
      const response = await POST(
        request("POST", admin, "http://localhost/api/orders", {
          customer_name: name,
          phone: "0912333444",
          service_type: "takeout",
          menu_set_id: wan,
          slot_id: slotId,
        }),
      );
      expect(response.status).toBe(201);
    };
    await create("多選中午客", noon);
    await create("多選晚上客", evening);
    await create("多選未選客", leftOut);

    const listed = await kitchenGet(
      request(
        "GET",
        admin,
        `http://localhost/api/kitchen?date=${DATE}&slot_id=${noon}&slot_id=${evening}`,
      ),
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      by_slot: { slot_id: string; label: string; totals: { dishName: string; qty: number }[] }[];
      combined: { dishName: string; qty: number }[];
      totals: { dishName: string; qty: number }[];
    };
    expect(body.by_slot.map((slot) => slot.slot_id)).toEqual([noon, evening]);
    expect(qtyOf(body.by_slot[0].totals, SHRIMP)).toBe(1);
    expect(qtyOf(body.by_slot[1].totals, SHRIMP)).toBe(1);
    expect(qtyOf(body.combined, SHRIMP)).toBe(2);
    expect(qtyOf(body.totals, SHRIMP)).toBe(2);
    expect(mergeDishTotals(body.by_slot.map((slot) => slot.totals))).toEqual(body.combined);
    expect(body.by_slot.some((slot) => slot.slot_id === leftOut)).toBe(false);
  });
});
