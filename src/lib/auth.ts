import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "./db";

export const SESSION_COOKIE = "hancheng_session";

export type Role = "admin" | "pickup" | "viewer";

export type User = {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
};

type UserRow = {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  password_hash?: string;
};

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required");
  }
  return "dev-insecure-session-secret";
}

/** Passwords: salted SHA-512 (Node crypto). Stored as sha512:<saltHex>:<digestHex>. Never plaintext. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = createHash("sha512").update(salt).update(password, "utf8").digest();
  return `sha512:${salt.toString("hex")}:${digest.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "sha512" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = createHash("sha512").update(salt).update(password, "utf8").digest();
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * If the users table is empty and ADMIN_PASSWORD is set, create username `admin`
 * with a salted SHA-512 hash. No password is stored in migrations or docs.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!password) return;
  const countRows = await sql<{ n: string | number }>("select count(*)::int as n from users");
  const count = Number(countRows[0]?.n ?? 0);
  if (count > 0) return;
  const passwordHash = await hashPassword(password);
  await sql(
    `insert into users (username, password_hash, role)
     values ('admin', $1, 'admin')
     on conflict (username) do nothing`,
    [passwordHash],
  );
}

export function createSession(user: Pick<User, "id">): string {
  const sig = createHmac("sha256", sessionSecret()).update(user.id).digest("base64url");
  return `${user.id}.${sig}`;
}

function verifySessionToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", sessionSecret()).update(userId).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return userId;
}

function sessionCookieFlags(extra: string[] = []): string[] {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", ...extra];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts;
}

export function sessionSetCookie(token: string): string {
  return [`${SESSION_COOKIE}=${token}`, ...sessionCookieFlags()].join("; ");
}

export function sessionClearCookie(): string {
  return [`${SESSION_COOKIE}=`, ...sessionCookieFlags(["Max-Age=0"])].join("; ");
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return undefined;
}

function unauthorized(): Response {
  return Response.json({ error: "未登入" }, { status: 401 });
}

function forbidden(): Response {
  return Response.json({ error: "沒有權限" }, { status: 403 });
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: Boolean(row.disabled),
  };
}

export async function requireUser(request: Request): Promise<User | Response> {
  await ensureBootstrapAdmin();
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return unauthorized();
  const userId = verifySessionToken(token);
  if (!userId) return unauthorized();
  const rows = await sql<UserRow>(
    "select id, username, role, disabled from users where id = $1",
    [userId],
  );
  const row = rows[0];
  if (!row || row.disabled) return unauthorized();
  return rowToUser(row);
}

export function requireRole(user: User, roles: Role[]): User | Response {
  if (!roles.includes(user.role)) return forbidden();
  return user;
}

export async function loginWithPassword(
  username: string,
  password: string,
): Promise<User | null> {
  await ensureBootstrapAdmin();
  const rows = await sql<UserRow>(
    "select id, username, role, disabled, password_hash from users where username = $1",
    [username],
  );
  const row = rows[0];
  if (!row || row.disabled) return null;
  if (!row.password_hash || !(await verifyPassword(password, row.password_hash))) return null;
  return rowToUser(row);
}
