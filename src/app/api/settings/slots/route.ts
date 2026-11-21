import { writeAudit } from "@/lib/audit";
import { requireRole, requireUser, type User } from "@/lib/auth";
import { sql } from "@/lib/db";

type SlotRow = {
  id: string;
  service_date: unknown;
  service_type: string;
  label: string;
  start_time: unknown;
  end_time: unknown;
};

type Body = {
  id?: unknown;
  service_date?: unknown;
  service_type?: unknown;
  label?: unknown;
  start_time?: unknown;
  end_time?: unknown;
};

function isResponse(value: User | Response): value is Response {
  return value instanceof Response;
}

async function requireAdmin(request: Request): Promise<User | Response> {
  const user = await requireUser(request);
  if (isResponse(user)) return user;
  return requireRole(user, ["admin"]);
}

async function readBody(request: Request): Promise<Body | Response> {
  try {
    return (await request.json()) as Body;
  } catch {
    return Response.json({ error: "資料格式錯誤" }, { status: 400 });
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function asDate(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  return raw;
}

function asTime(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  return undefined;
}

function asServiceType(value: unknown): "takeout" | "dine_in" | undefined {
  const raw = asString(value);
  if (raw === "takeout" || raw === "dine_in") return raw;
  return undefined;
}

function formatDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function formatTime(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const h = String(value.getUTCHours()).padStart(2, "0");
    const m = String(value.getUTCMinutes()).padStart(2, "0");
    const s = String(value.getUTCSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  const raw = String(value);
  const match = raw.match(/^(\d{2}:\d{2}(?::\d{2})?)/);
  if (!match) return raw;
  return match[1].length === 5 ? `${match[1]}:00` : match[1];
}

function serialize(row: SlotRow) {
  return {
    id: row.id,
    service_date: formatDate(row.service_date),
    service_type: row.service_type,
    label: row.label,
    start_time: formatTime(row.start_time),
    end_time: formatTime(row.end_time),
  };
}

const SELECT_SLOTS = `select id, service_date, service_type, label, start_time, end_time
  from day_slots`;

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (isResponse(user)) return user;

  const rows = await sql<SlotRow>(
    `${SELECT_SLOTS} order by service_date, start_time, label`,
  );
  return Response.json({ slots: rows.map(serialize) });
}

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const body = await readBody(request);
  if (body instanceof Response) return body;

  const serviceDate = asDate(body.service_date);
  const serviceType = asServiceType(body.service_type);
  const label = asString(body.label);
  const startTime = asTime(body.start_time);
  const endTime = asTime(body.end_time);
  if (!serviceDate || !serviceType || !label || !startTime || !endTime) {
    return Response.json({ error: "日期、類型、標籤與起迄時間必填" }, { status: 400 });
  }

  const rows = await sql<SlotRow>(
    `insert into day_slots (service_date, service_type, label, start_time, end_time)
     values ($1, $2, $3, $4, $5)
     returning id, service_date, service_type, label, start_time, end_time`,
    [serviceDate, serviceType, label, startTime, endTime],
  );
  const after = serialize(rows[0]);
  await writeAudit({
    userId: admin.id,
    action: "create",
    entity: "day_slots",
    entityId: after.id,
    after,
  });
  return Response.json(after, { status: 201 });
}

export async function PATCH(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const body = await readBody(request);
  if (body instanceof Response) return body;

  const id = asString(body.id);
  if (!id) return Response.json({ error: "缺少時段" }, { status: 400 });
  const beforeRow = (await sql<SlotRow>(`${SELECT_SLOTS} where id = $1`, [id]))[0];
  if (!beforeRow) return Response.json({ error: "找不到時段" }, { status: 404 });
  const before = serialize(beforeRow);

  const serviceDate = asDate(body.service_date) ?? before.service_date;
  const serviceType = asServiceType(body.service_type) ?? (before.service_type as "takeout" | "dine_in");
  const label = asString(body.label) ?? before.label;
  const startTime = asTime(body.start_time) ?? before.start_time;
  const endTime = asTime(body.end_time) ?? before.end_time;
  if (!serviceType) {
    return Response.json({ error: "類型須為外帶或內用" }, { status: 400 });
  }

  const afterRow = (
    await sql<SlotRow>(
      `update day_slots
       set service_date = $1, service_type = $2, label = $3, start_time = $4, end_time = $5
       where id = $6
       returning id, service_date, service_type, label, start_time, end_time`,
      [serviceDate, serviceType, label, startTime, endTime, id],
    )
  )[0];
  const after = serialize(afterRow);
  await writeAudit({
    userId: admin.id,
    action: "update",
    entity: "day_slots",
    entityId: id,
    before,
    after,
  });
  return Response.json(after);
}

export async function DELETE(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const body = await readBody(request);
  if (body instanceof Response) return body;

  const id = asString(body.id);
  if (!id) return Response.json({ error: "缺少時段" }, { status: 400 });
  const beforeRow = (await sql<SlotRow>(`${SELECT_SLOTS} where id = $1`, [id]))[0];
  if (!beforeRow) return Response.json({ error: "找不到時段" }, { status: 404 });
  const before = serialize(beforeRow);

  try {
    await sql("delete from day_slots where id = $1", [id]);
  } catch {
    return Response.json({ error: "時段已有訂單，無法刪除" }, { status: 409 });
  }
  await writeAudit({
    userId: admin.id,
    action: "delete",
    entity: "day_slots",
    entityId: id,
    before,
  });
  return Response.json({ ok: true });
}
