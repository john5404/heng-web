import { writeAudit } from "@/lib/audit";
import { hashPassword, requireRole, requireUser, type Role, type User } from "@/lib/auth";
import { sql } from "@/lib/db";

type UserRow = {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  created_at: Date | string;
};

type Body = {
  id?: unknown;
  username?: unknown;
  password?: unknown;
  role?: unknown;
  disabled?: unknown;
};

const ROLES: Role[] = ["admin", "pickup", "viewer"];

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

function asRole(value: unknown): Role | undefined {
  const raw = asString(value);
  if (raw === "admin" || raw === "pickup" || raw === "viewer") return raw;
  return undefined;
}

function asIso(value: Date | string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function publicUser(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: Boolean(row.disabled),
    created_at: asIso(row.created_at),
  };
}

const SELECT_USER = "select id, username, role, disabled, created_at from users";

export async function GET(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const rows = await sql<UserRow>(`${SELECT_USER} order by username`);
  return Response.json({ users: rows.map(publicUser) });
}

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const body = await readBody(request);
  if (body instanceof Response) return body;

  const username = asString(body.username);
  const password = asString(body.password);
  const role = asRole(body.role);
  if (!username || username.length > 64 || /\s/.test(username)) {
    return Response.json({ error: "帳號必填且不可含空白" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return Response.json({ error: "密碼至少 8 個字" }, { status: 400 });
  }
  if (!role || !ROLES.includes(role)) {
    return Response.json({ error: "角色須為管理、領餐或查看" }, { status: 400 });
  }

  const existing = await sql<{ id: string }>("select id from users where username = $1", [username]);
  if (existing[0]) return Response.json({ error: "帳號已存在" }, { status: 409 });

  const passwordHash = await hashPassword(password);
  const rows = await sql<UserRow>(
    `insert into users (username, password_hash, role)
     values ($1, $2, $3)
     returning id, username, role, disabled, created_at`,
    [username, passwordHash, role],
  );
  const after = publicUser(rows[0]);
  await writeAudit({
    userId: admin.id,
    action: "create",
    entity: "users",
    entityId: after.id,
    after,
  });
  return Response.json(after, { status: 201 });
}

async function keepsAnAdmin(target: UserRow, nextRole: Role, nextDisabled: boolean): Promise<true | Response> {
  const enabledAdmin = target.role === "admin" && !target.disabled;
  const staysAdmin = nextRole === "admin" && !nextDisabled;
  if (!enabledAdmin || staysAdmin) return true;
  if (target.username === "admin") {
    return Response.json({ error: "不能停用或變更預設管理員" }, { status: 400 });
  }
  const others = await sql<{ id: string }>(
    "select id from users where role = 'admin' and disabled = false and id <> $1",
    [target.id],
  );
  if (others.length === 0) {
    return Response.json({ error: "至少要保留一位管理員" }, { status: 400 });
  }
  return true;
}

export async function PATCH(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  const body = await readBody(request);
  if (body instanceof Response) return body;

  const id = asString(body.id);
  if (!id) return Response.json({ error: "缺少帳號" }, { status: 400 });
  const beforeRow = (await sql<UserRow>(`${SELECT_USER} where id = $1`, [id]))[0];
  if (!beforeRow) return Response.json({ error: "找不到帳號" }, { status: 404 });

  const nextRole = body.role === undefined ? beforeRow.role : asRole(body.role);
  if (!nextRole) return Response.json({ error: "角色須為管理、領餐或查看" }, { status: 400 });

  let nextDisabled = beforeRow.disabled;
  if (body.disabled !== undefined) {
    if (typeof body.disabled !== "boolean") {
      return Response.json({ error: "停用狀態不正確" }, { status: 400 });
    }
    nextDisabled = body.disabled;
  }

  let passwordHash: string | undefined;
  if (body.password !== undefined) {
    const password = asString(body.password);
    if (!password || password.length < 8) {
      return Response.json({ error: "密碼至少 8 個字" }, { status: 400 });
    }
    passwordHash = await hashPassword(password);
  }

  if (body.role === undefined && body.disabled === undefined && passwordHash === undefined) {
    return Response.json({ error: "沒有要更新的內容" }, { status: 400 });
  }

  const guard = await keepsAnAdmin(beforeRow, nextRole, nextDisabled);
  if (guard instanceof Response) return guard;

  const afterRow = passwordHash
    ? (
        await sql<UserRow>(
          `update users set role = $1, disabled = $2, password_hash = $3
           where id = $4
           returning id, username, role, disabled, created_at`,
          [nextRole, nextDisabled, passwordHash, id],
        )
      )[0]
    : (
        await sql<UserRow>(
          `update users set role = $1, disabled = $2
           where id = $3
           returning id, username, role, disabled, created_at`,
          [nextRole, nextDisabled, id],
        )
      )[0];

  const before = publicUser(beforeRow);
  const after = publicUser(afterRow);
  await writeAudit({
    userId: admin.id,
    action: "update",
    entity: "users",
    entityId: id,
    before,
    after: passwordHash ? { ...after, password_changed: true } : after,
  });
  return Response.json(after);
}
