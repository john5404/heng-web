import { describe, expect, it } from "vitest";
import { createSession, SESSION_COOKIE } from "../src/lib/auth";
import { homeDestination } from "../src/lib/home";
import { sql } from "../src/lib/db";

function request(cookie?: string): Request {
  return new Request("http://localhost/", {
    headers: cookie ? { cookie } : {},
  });
}

describe("home destination", () => {
  it("sends an anonymous visitor to /login and a signed-in user to /floor", async () => {
    expect(await homeDestination(request())).toBe("/login");
    expect(await homeDestination(request(`${SESSION_COOKIE}=not-a-session`))).toBe("/login");

    const rows = await sql<{ id: string }>("select id from users where username = $1", ["admin"]);
    const cookie = `${SESSION_COOKIE}=${createSession({ id: rows[0].id })}`;
    expect(await homeDestination(request(cookie))).toBe("/floor");
  });
});
