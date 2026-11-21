import { describe, expect, it } from "vitest";
import { DELETE, GET, PATCH, POST } from "../src/app/api/settings/slots/route";
import { createSession, hashPassword, SESSION_COOKIE } from "../src/lib/auth";
import { sql } from "../src/lib/db";

/** 2027 除夕 / 初四 (LNY 2027-02-06). */
const CHU_XI = "2027-02-05";
const CHU_SI = "2027-02-09";

type Slot = {
  id: string;
  service_date: string;
  service_type: string;
  label: string;
  start_time: string;
  end_time: string;
};

async function adminCookie(): Promise<string> {
  const rows = await sql<{ id: string }>("select id from users where username = $1", ["admin"]);
  return `${SESSION_COOKIE}=${createSession({ id: rows[0].id })}`;
}

async function roleCookie(username: string, role: "viewer" | "pickup"): Promise<string> {
  const existing = await sql<{ id: string }>("select id from users where username = $1", [username]);
  if (existing[0]) {
    return `${SESSION_COOKIE}=${createSession({ id: existing[0].id })}`;
  }
  const passwordHash = await hashPassword("temp-pass");
  await sql("insert into users (username, password_hash, role) values ($1, $2, $3)", [
    username,
    passwordHash,
    role,
  ]);
  const rows = await sql<{ id: string }>("select id from users where username = $1", [username]);
  return `${SESSION_COOKIE}=${createSession({ id: rows[0].id })}`;
}

function request(method: string, cookie: string, body?: unknown): Request {
  return new Request("http://localhost/api/settings/slots", {
    method,
    headers: {
      cookie,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function asSlots(data: unknown): Slot[] {
  const slots = (data as { slots: Slot[] }).slots;
  return slots.map((s) => ({
    ...s,
    service_date: String(s.service_date).slice(0, 10),
    start_time: String(s.start_time).slice(0, 5),
    end_time: String(s.end_time).slice(0, 5),
  }));
}

describe("day slots API", () => {
  it("lets 除夕 keep two takeout windows and one dine_in evening, and stores 初四 separately", async () => {
    const cookie = await adminCookie();

    const takeoutA = await POST(
      request("POST", cookie, {
        service_date: CHU_XI,
        service_type: "takeout",
        label: "下午2:00~2:30",
        start_time: "14:00",
        end_time: "14:30",
      }),
    );
    const takeoutB = await POST(
      request("POST", cookie, {
        service_date: CHU_XI,
        service_type: "takeout",
        label: "下午4:00~5:00",
        start_time: "16:00",
        end_time: "17:00",
      }),
    );
    const dineIn = await POST(
      request("POST", cookie, {
        service_date: CHU_XI,
        service_type: "dine_in",
        label: "晚上6:00",
        start_time: "18:00",
        end_time: "21:00",
      }),
    );
    expect(takeoutA.status).toBe(201);
    expect(takeoutB.status).toBe(201);
    expect(dineIn.status).toBe(201);

    const chuSi = await POST(
      request("POST", cookie, {
        service_date: CHU_SI,
        service_type: "takeout",
        label: "初四外帶",
        start_time: "14:00",
        end_time: "15:00",
      }),
    );
    expect(chuSi.status).toBe(201);

    const listed = await GET(request("GET", cookie));
    expect(listed.status).toBe(200);
    const slots = asSlots(await listed.json());

    const eve = slots.filter((s) => s.service_date === CHU_XI);
    const takeoutLabels = eve.filter((s) => s.service_type === "takeout").map((s) => s.label);
    expect(takeoutLabels).toEqual(expect.arrayContaining(["下午2:00~2:30", "下午4:00~5:00"]));
    expect(eve.find((s) => s.service_type === "dine_in" && s.label === "晚上6:00")).toMatchObject({
      label: "晚上6:00",
      start_time: "18:00",
      end_time: "21:00",
    });

    const fourth = slots.filter((s) => s.service_date === CHU_SI && s.label === "初四外帶");
    expect(fourth).toHaveLength(1);
    expect(fourth[0]).toMatchObject({
      service_type: "takeout",
      label: "初四外帶",
      start_time: "14:00",
      end_time: "15:00",
    });
    expect(eve.every((s) => s.service_date !== CHU_SI)).toBe(true);
  });

  it("lets a viewer read slots but not write", async () => {
    const cookie = await roleCookie("slots_viewer", "viewer");
    const get = await GET(request("GET", cookie));
    expect(get.status).toBe(200);

    const post = await POST(
      request("POST", cookie, {
        service_date: CHU_XI,
        service_type: "takeout",
        label: "不該寫入",
        start_time: "11:00",
        end_time: "12:00",
      }),
    );
    expect(post.status).toBe(403);
    const leaked = await sql<{ id: string }>("select id from day_slots where label = $1", ["不該寫入"]);
    expect(leaked).toHaveLength(0);
  });

  it("rejects pickup writes with 403", async () => {
    const cookie = await roleCookie("slots_pickup", "pickup");
    const response = await POST(
      request("POST", cookie, {
        service_date: CHU_SI,
        service_type: "dine_in",
        label: "領餐不該建時段",
        start_time: "18:00",
        end_time: "19:00",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects unauthenticated reads with 401", async () => {
    const response = await GET(new Request("http://localhost/api/settings/slots"));
    expect(response.status).toBe(401);
  });

  it("lets an admin update a slot label and writes audit", async () => {
    const cookie = await adminCookie();
    const created = await POST(
      request("POST", cookie, {
        service_date: "2027-02-07",
        service_type: "takeout",
        label: "初二下午",
        start_time: "15:00",
        end_time: "16:00",
      }),
    );
    expect(created.status).toBe(201);
    const slot = (await created.json()) as Slot;

    const patched = await PATCH(
      request("PATCH", cookie, {
        id: slot.id,
        label: "初二下午改時",
        start_time: "15:30",
        end_time: "16:30",
      }),
    );
    expect(patched.status).toBe(200);
    const after = asSlots({ slots: [await patched.json()] })[0];
    expect(after).toMatchObject({
      id: slot.id,
      label: "初二下午改時",
      start_time: "15:30",
      end_time: "16:30",
    });

    const audits = await sql<{ action: string; entity: string }>(
      "select action, entity from audit_logs where entity = $1 and entity_id = $2 order by created_at desc limit 1",
      ["day_slots", slot.id],
    );
    expect(audits[0]?.action).toBe("update");
  });

  it("blocks deleting a slot that still has orders", async () => {
    const cookie = await adminCookie();
    const created = await POST(
      request("POST", cookie, {
        service_date: "2027-02-08",
        service_type: "dine_in",
        label: "有訂單時段",
        start_time: "18:00",
        end_time: "20:00",
      }),
    );
    const slot = (await created.json()) as Slot;
    await sql(
      `insert into order_items (customer_name, phone, service_type, slot_id, price)
       values ('時段客人', '0900000099', 'dine_in', $1, 8000)`,
      [slot.id],
    );
    const response = await DELETE(request("DELETE", cookie, { id: slot.id }));
    expect(response.status).toBe(409);
    const still = (await sql<{ id: string }>("select id from day_slots where id = $1", [slot.id]))[0];
    expect(still?.id).toBe(slot.id);
  });
});
