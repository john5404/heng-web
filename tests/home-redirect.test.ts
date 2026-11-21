import { describe, expect, it } from "vitest";
import { createSession, hashPassword, SESSION_COOKIE } from "../src/lib/auth";
import { homeDestination } from "../src/lib/home";
import { sql } from "../src/lib/db";

function request(cookie?: string): Request {
  return new Request("http://localhost/", {
    headers: cookie ? { cookie } : {},
  });
}

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

describe("home destination", () => {
  it("sends an anonymous visitor to /login and a signed-in user to /floor", async () => {
    expect(await homeDestination(request())).toBe("/login");
    expect(await homeDestination(request(`${SESSION_COOKIE}=not-a-session`))).toBe("/login");

    const id = await ensureAdminUser();
    const cookie = `${SESSION_COOKIE}=${createSession({ id })}`;
    expect(await homeDestination(request(cookie))).toBe("/floor");
  });
});
