import { describe, expect, it } from "vitest";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { PATCH as patchUser } from "../src/app/api/settings/users/route";
import { createSession, hashPassword, requireUser, SESSION_COOKIE, sessionSetCookie, type User } from "../src/lib/auth";
import { sql } from "../src/lib/db";

async function ensureUser(username: string, role: "admin" | "viewer", password: string): Promise<string> {
  const passwordHash = await hashPassword(password);
  await sql(
    `insert into users (username, password_hash, role, disabled)
     values ($1, $2, $3, false)
     on conflict (username) do update
       set password_hash = excluded.password_hash, role = excluded.role, disabled = false`,
    [username, passwordHash, role],
  );
  const rows = await sql<{ id: string }>("select id from users where username = $1", [username]);
  return rows[0].id;
}

function authed(token: string): Request {
  return new Request("http://localhost/", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await sql<{ n: number | string }>("select count(*)::int as n from sessions where user_id = $1", [
    userId,
  ]);
  return Number(rows[0]?.n ?? 0);
}

describe("server sessions", () => {
  it("stores a hash and rejects the cookie after it expires", async () => {
    const id = await ensureUser("session_expire", "viewer", "expire-pass-1");
    const token = await createSession({ id });
    const stored = await sql<{ token_hash: string }>("select token_hash from sessions where user_id = $1", [id]);
    expect(stored[0].token_hash).not.toBe(token);
    expect(stored[0].token_hash).toHaveLength(64);
    expect((await requireUser(authed(token)))).not.toBeInstanceOf(Response);

    await sql("update sessions set expires_at = now() - interval '1 minute' where user_id = $1", [id]);
    const expired = await requireUser(authed(token));
    expect(expired).toBeInstanceOf(Response);
    expect((expired as Response).status).toBe(401);
  });

  it("logout deletes the session so the old cookie returns 401", async () => {
    const id = await ensureUser("session_logout", "viewer", "logout-pass-1");
    const token = await createSession({ id });
    const response = await logout(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    const again = await requireUser(authed(token));
    expect(again).toBeInstanceOf(Response);
    expect((again as Response).status).toBe(401);
    expect(await sessionCount(id)).toBe(0);
  });

  it("drops every session when the password is changed", async () => {
    const adminId = await ensureUser("session_admin", "admin", "session-admin-1");
    const id = await ensureUser("session_reset", "viewer", "reset-pass-1");
    const token = await createSession({ id });
    const extra = await createSession({ id });
    const adminCookie = `${SESSION_COOKIE}=${await createSession({ id: adminId })}`;
    const changed = await patchUser(
      new Request("http://localhost/api/settings/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ id, password: "reset-pass-2" }),
      }),
    );
    expect(changed.status).toBe(200);
    expect(await sessionCount(id)).toBe(0);
    for (const old of [token, extra]) {
      const rejected = await requireUser(authed(old));
      expect(rejected).toBeInstanceOf(Response);
      expect((rejected as Response).status).toBe(401);
    }
    const signedIn = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.40" },
        body: JSON.stringify({ username: "session_reset", password: "reset-pass-2" }),
      }),
    );
    expect(signedIn.status).toBe(200);
  });

  it("drops sessions on disable and does not revive them when the user is enabled again", async () => {
    const adminId = await ensureUser("session_admin", "admin", "session-admin-1");
    const id = await ensureUser("session_disable", "viewer", "disable-pass-1");
    const token = await createSession({ id });
    const adminCookie = `${SESSION_COOKIE}=${await createSession({ id: adminId })}`;
    const patch = (body: unknown) =>
      patchUser(
        new Request("http://localhost/api/settings/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", cookie: adminCookie },
          body: JSON.stringify(body),
        }),
      );

    expect((await patch({ id, disabled: true })).status).toBe(200);
    expect(await sessionCount(id)).toBe(0);
    const disabled = await requireUser(authed(token));
    expect(disabled).toBeInstanceOf(Response);
    expect((disabled as Response).status).toBe(401);

    expect((await patch({ id, disabled: false })).status).toBe(200);
    expect(await sessionCount(id)).toBe(0);
    const revived = await requireUser(authed(token));
    expect(revived).toBeInstanceOf(Response);
    expect((revived as Response).status).toBe(401);

    const signedIn = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.41" },
        body: JSON.stringify({ username: "session_disable", password: "disable-pass-1" }),
      }),
    );
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.get("Set-Cookie") ?? "";
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie).toContain("SameSite=Lax");
    const fresh = cookie.split(";")[0].slice(`${SESSION_COOKIE}=`.length);
    const user = await requireUser(authed(fresh));
    expect(user).not.toBeInstanceOf(Response);
    expect((user as User).username).toBe("session_disable");
  });

  it("marks the session cookie Secure in production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const header = sessionSetCookie("token");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("SameSite=Lax");
      expect(header).toContain("Secure");
      expect(header).toContain("Max-Age=43200");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
