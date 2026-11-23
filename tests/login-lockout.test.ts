import { describe, expect, it } from "vitest";
import { POST as login } from "../src/app/api/auth/login/route";
import { PATCH as patchUser } from "../src/app/api/settings/users/route";
import { createSession, hashPassword, SESSION_COOKIE } from "../src/lib/auth";
import { sql } from "../src/lib/db";
import { LOGIN_LOCK_MESSAGE } from "../src/lib/login-limit";

const BAD_LOGIN = "帳號或密碼錯誤";

async function ensureUser(username: string, role: "admin" | "viewer", password: string): Promise<string> {
  const passwordHash = await hashPassword(password);
  await sql(
    `insert into users (username, password_hash, role)
     values ($1, $2, $3)
     on conflict (username) do update set password_hash = excluded.password_hash, role = excluded.role, disabled = false`,
    [username, passwordHash, role],
  );
  const rows = await sql<{ id: string }>("select id from users where username = $1", [username]);
  return rows[0].id;
}

function attempt(username: string, password: string, ip: string): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ username, password }),
  });
}

async function bodyOf(response: Response): Promise<{ error?: string }> {
  return (await response.json()) as { error?: string };
}

describe("login lockout", () => {
  it("returns the same 401 for an unknown user and a wrong password, and counts both", async () => {
    const ip = "203.0.113.21";
    await ensureUser("lock_known", "viewer", "known-pass-1");
    const unknown = await login(attempt("lock_no_such_user", "whatever-1", ip));
    const wrong = await login(attempt("lock_known", "not-the-password", ip));
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await bodyOf(unknown)).toEqual({ error: BAD_LOGIN });
    expect(await bodyOf(wrong)).toEqual({ error: BAD_LOGIN });
    const counts = await sql<{ username: string; failures: number }>(
      `select username, failures from login_account_limits
       where username in ('lock_no_such_user', 'lock_known')
       order by username`,
    );
    expect(counts).toEqual([
      { username: "lock_known", failures: 1 },
      { username: "lock_no_such_user", failures: 1 },
    ]);
  });

  it("locks an account for 15 minutes after five wrong passwords, including a later correct one", async () => {
    const ip = "203.0.113.22";
    await ensureUser("lock_target", "viewer", "target-pass-1");
    for (let n = 0; n < 5; n += 1) {
      const response = await login(attempt("lock_target", "wrong-pass", ip));
      expect(response.status).toBe(401);
      expect(await bodyOf(response)).toEqual({ error: BAD_LOGIN });
    }
    const locked = await login(attempt("lock_target", "target-pass-1", ip));
    expect(locked.status).toBe(429);
    expect(await bodyOf(locked)).toEqual({ error: LOGIN_LOCK_MESSAGE });

    await sql(
      `update login_account_limits set locked_until = now() - interval '1 minute' where username = $1`,
      ["lock_target"],
    );
    const afterExpiry = await login(attempt("lock_target", "still-wrong", ip));
    expect(afterExpiry.status).toBe(401);
    const row = await sql<{ failures: number; locked_until: Date | null }>(
      "select failures, locked_until from login_account_limits where username = $1",
      ["lock_target"],
    );
    expect(row[0].failures).toBe(1);
    expect(row[0].locked_until).toBeNull();
  });

  it("resets the account count after a successful login", async () => {
    const ip = "203.0.113.23";
    await ensureUser("lock_reset", "viewer", "reset-pass-1");
    for (let n = 0; n < 4; n += 1) {
      expect((await login(attempt("lock_reset", "wrong-pass", ip))).status).toBe(401);
    }
    const ok = await login(attempt("lock_reset", "reset-pass-1", ip));
    expect(ok.status).toBe(200);
    const cleared = await sql<{ n: number }>(
      "select count(*)::int as n from login_account_limits where username = $1",
      ["lock_reset"],
    );
    expect(Number(cleared[0].n)).toBe(0);
    for (let n = 0; n < 4; n += 1) {
      expect((await login(attempt("lock_reset", "wrong-pass", ip))).status).toBe(401);
    }
    expect((await login(attempt("lock_reset", "wrong-pass", `${ip}.2`))).status).toBe(401);
  });

  it("allows 10 login attempts per IP each minute and then returns 429", async () => {
    const ip = "203.0.113.24";
    for (let n = 0; n < 10; n += 1) {
      const response = await login(attempt(`lock_ip_user_${n}`, "wrong-pass", ip));
      expect(response.status).toBe(401);
    }
    const blocked = await login(attempt("lock_ip_user_extra", "wrong-pass", ip));
    expect(blocked.status).toBe(429);
    expect(await bodyOf(blocked)).toEqual({ error: LOGIN_LOCK_MESSAGE });

    const otherIp = await login(attempt("lock_ip_user_extra", "wrong-pass", "203.0.113.25"));
    expect(otherIp.status).toBe(401);

    await sql(`update login_ip_attempts set attempted_at = now() - interval '2 minutes' where ip = $1`, [ip]);
    const afterWindow = await login(attempt("lock_ip_user_later", "wrong-pass", ip));
    expect(afterWindow.status).toBe(401);
  });

  it("lets an admin unlock a locked account", async () => {
    const ip = "203.0.113.26";
    const adminId = await ensureUser("lock_admin", "admin", "admin-pass-1");
    await ensureUser("lock_staff", "viewer", "staff-pass-1");
    for (let n = 0; n < 5; n += 1) {
      expect((await login(attempt("lock_staff", "wrong-pass", ip))).status).toBe(401);
    }
    expect((await login(attempt("lock_staff", "staff-pass-1", ip))).status).toBe(429);

    const cookie = `${SESSION_COOKIE}=${await createSession({ id: adminId })}`;
    const viewerId = await ensureUser("lock_viewer", "viewer", "viewer-pass-1");
    const viewerCookie = `${SESSION_COOKIE}=${await createSession({ id: viewerId })}`;
    const denied = await patchUser(
      new Request("http://localhost/api/settings/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: viewerCookie },
        body: JSON.stringify({ id: (await sql<{ id: string }>("select id from users where username = $1", ["lock_staff"]))[0].id, unlock: true }),
      }),
    );
    expect(denied.status).toBe(403);

    const staffId = (await sql<{ id: string }>("select id from users where username = $1", ["lock_staff"]))[0].id;
    const unlocked = await patchUser(
      new Request("http://localhost/api/settings/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ id: staffId, unlock: true }),
      }),
    );
    expect(unlocked.status).toBe(200);
    expect(((await unlocked.json()) as { locked: boolean }).locked).toBe(false);
    const ok = await login(attempt("lock_staff", "staff-pass-1", ip));
    expect(ok.status).toBe(200);
  });
});
