import { describe, expect, it } from "vitest";
import { GET as getAudit } from "../src/app/api/audit/route";
import { DELETE } from "../src/app/api/orders/[id]/route";
import { POST as createOrder } from "../src/app/api/orders/route";
import { GET as listUsers, PATCH as patchUser, POST as createUser } from "../src/app/api/settings/users/route";
import { createSession, hashPassword, loginWithPassword, SESSION_COOKIE } from "../src/lib/auth";
import { sql } from "../src/lib/db";

type AuditRow = {
  id: string;
  username: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
};

type PublicUser = {
  id: string;
  username: string;
  role: "admin" | "pickup" | "viewer";
  disabled: boolean;
};

async function adminCookie(): Promise<string> {
  const rows = await sql<{ id: string }>("select id from users where username = $1", ["admin"]);
  return `${SESSION_COOKIE}=${createSession({ id: rows[0].id })}`;
}

async function roleCookie(username: string, role: "viewer" | "pickup" | "admin"): Promise<string> {
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

async function slotId(): Promise<string> {
  const existing = await sql<{ id: string }>(
    "select id from day_slots where label = $1 limit 1",
    ["紀錄測試時段"],
  );
  if (existing[0]) return existing[0].id;
  const rows = await sql<{ id: string }>(
    `insert into day_slots (service_date, service_type, label, start_time, end_time)
     values ('2027-02-06', 'takeout', '紀錄測試時段', '15:00', '15:30')
     returning id`,
  );
  return rows[0].id;
}

describe("audit log", () => {
  it("records an order delete and lets only an admin read it", async () => {
    const admin = await adminCookie();
    const slot = await slotId();
    const sets = await sql<{ id: string }>("select id from menu_sets where name = $1", ["六千六套餐"]);
    const created = await createOrder(
      request("POST", admin, "http://localhost/api/orders", {
        customer_name: "紀錄刪單",
        phone: "0912888000",
        service_type: "takeout",
        menu_set_id: sets[0].id,
        slot_id: slot,
        price: 6600,
      }),
    );
    expect(created.status).toBe(201);
    const order = (await created.json()) as { id: string };

    const removed = await DELETE(request("DELETE", admin, `http://localhost/api/orders/${order.id}`), {
      params: Promise.resolve({ id: order.id }),
    });
    expect(removed.status).toBe(200);

    const listed = await getAudit(request("GET", admin, "http://localhost/api/audit"));
    expect(listed.status).toBe(200);
    const logs = ((await listed.json()) as { logs: AuditRow[] }).logs;
    const hit = logs.find((row) => row.entity === "order_items" && row.entity_id === order.id && row.action === "delete");
    expect(hit).toBeTruthy();
    expect(hit?.username).toBe("admin");

    const viewer = await roleCookie("audit_viewer", "viewer");
    const denied = await getAudit(request("GET", viewer, "http://localhost/api/audit"));
    expect(denied.status).toBe(403);

    const pickup = await roleCookie("audit_pickup", "pickup");
    const pickupDenied = await getAudit(request("GET", pickup, "http://localhost/api/audit"));
    expect(pickupDenied.status).toBe(403);

    const anon = await getAudit(request("GET", undefined, "http://localhost/api/audit"));
    expect(anon.status).toBe(401);
  });
});

describe("user admin", () => {
  it("lets an admin create a user, change role and password, then disable them", async () => {
    const admin = await adminCookie();
    const username = "floor_temp";
    const created = await createUser(
      request("POST", admin, "http://localhost/api/settings/users", {
        username,
        password: "temp-pass-8",
        role: "pickup",
      }),
    );
    expect(created.status).toBe(201);
    const user = (await created.json()) as PublicUser;
    expect(user.username).toBe(username);
    expect(user.role).toBe("pickup");
    expect(user.disabled).toBe(false);
    expect(JSON.stringify(user)).not.toContain("password");

    const listed = await listUsers(request("GET", admin, "http://localhost/api/settings/users"));
    expect(listed.status).toBe(200);
    const users = ((await listed.json()) as { users: PublicUser[] }).users;
    expect(users.some((row) => row.id === user.id)).toBe(true);

    const updated = await patchUser(
      request("PATCH", admin, "http://localhost/api/settings/users", {
        id: user.id,
        role: "viewer",
        password: "new-pass-8",
      }),
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as PublicUser).role).toBe("viewer");
    expect(await loginWithPassword(username, "temp-pass-8")).toBeNull();
    expect((await loginWithPassword(username, "new-pass-8"))?.role).toBe("viewer");

    const disabled = await patchUser(
      request("PATCH", admin, "http://localhost/api/settings/users", {
        id: user.id,
        disabled: true,
      }),
    );
    expect(disabled.status).toBe(200);
    expect(((await disabled.json()) as PublicUser).disabled).toBe(true);
    expect(await loginWithPassword(username, "new-pass-8")).toBeNull();

    const audits = await sql<{ action: string }>(
      "select action from audit_logs where entity = $1 and entity_id = $2 order by created_at",
      ["users", user.id],
    );
    expect(audits.map((row) => row.action)).toEqual(["create", "update", "update"]);
  });

  it("rejects a viewer managing accounts", async () => {
    const viewer = await roleCookie("users_viewer", "viewer");
    const listed = await listUsers(request("GET", viewer, "http://localhost/api/settings/users"));
    expect(listed.status).toBe(403);
    const created = await createUser(
      request("POST", viewer, "http://localhost/api/settings/users", {
        username: "should_fail",
        password: "temp-pass-8",
        role: "viewer",
      }),
    );
    expect(created.status).toBe(403);
  });

  it("refuses to disable or demote the seeded admin", async () => {
    const admin = await adminCookie();
    const rows = await sql<{ id: string }>("select id from users where username = $1", ["admin"]);
    const disabled = await patchUser(
      request("PATCH", admin, "http://localhost/api/settings/users", {
        id: rows[0].id,
        disabled: true,
      }),
    );
    expect(disabled.status).toBe(400);
    const demoted = await patchUser(
      request("PATCH", admin, "http://localhost/api/settings/users", {
        id: rows[0].id,
        role: "viewer",
      }),
    );
    expect(demoted.status).toBe(400);
    const still = await sql<{ role: string; disabled: boolean }>(
      "select role, disabled from users where username = $1",
      ["admin"],
    );
    expect(still[0]).toMatchObject({ role: "admin", disabled: false });
  });

  it("refuses to disable the last remaining admin", async () => {
    const admin = await adminCookie();
    const created = await createUser(
      request("POST", admin, "http://localhost/api/settings/users", {
        username: "only_admin",
        password: "temp-pass-8",
        role: "admin",
      }),
    );
    expect(created.status).toBe(201);
    const user = (await created.json()) as PublicUser;
    await sql("update users set disabled = true where username = $1", ["admin"]);
    try {
      const cookie = `${SESSION_COOKIE}=${createSession({ id: user.id })}`;
      const denied = await patchUser(
        request("PATCH", cookie, "http://localhost/api/settings/users", {
          id: user.id,
          disabled: true,
        }),
      );
      expect(denied.status).toBe(400);
      const row = await sql<{ disabled: boolean }>("select disabled from users where id = $1", [user.id]);
      expect(row[0]?.disabled).toBe(false);
    } finally {
      await sql("update users set disabled = false where username = $1", ["admin"]);
    }
  });
});
