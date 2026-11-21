import { describe, expect, it } from "vitest";
import { POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import {
  createSession,
  hashPassword,
  loginWithPassword,
  requireRole,
  requireUser,
  SESSION_COOKIE,
  sessionClearCookie,
  verifyPassword,
  type User,
} from "../src/lib/auth";
import { sql } from "../src/lib/db";

function pickupUser(): User {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    username: "pickup",
    role: "pickup",
    disabled: false,
  };
}

function adminUser(): User {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    username: "admin",
    role: "admin",
    disabled: false,
  };
}

describe("requireRole", () => {
  it("rejects a pickup user for admin-only routes", async () => {
    const result = await requireRole(pickupUser(), ["admin"]);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it("allows an admin for admin-only routes", () => {
    const result = requireRole(adminUser(), ["admin"]);
    expect(result).toEqual(adminUser());
  });
});

describe("passwords", () => {
  it("verifies a hash of the same password", async () => {
    const stored = await hashPassword("correct-horse");
    expect(stored.startsWith("scrypt:")).toBe(true);
    expect(await verifyPassword("correct-horse", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });
});

describe("login and sessions", () => {
  it("rejects a disabled user", async () => {
    const passwordHash = await hashPassword("temp-pass-1");
    await sql(
      "insert into users (username, password_hash, role, disabled) values ($1, $2, $3, true)",
      ["disabled_staff", passwordHash, "pickup"],
    );
    expect(await loginWithPassword("disabled_staff", "temp-pass-1")).toBeNull();
    const response = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "disabled_staff", password: "temp-pass-1" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("logs in the seeded admin and requireUser reads the session", async () => {
    const user = await loginWithPassword("admin", "Hancheng2027!");
    expect(user?.username).toBe("admin");
    expect(user?.role).toBe("admin");

    const response = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "Hancheng2027!" }),
      }),
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");

    const token = setCookie.split(";")[0].slice(`${SESSION_COOKIE}=`.length);
    const authed = await requireUser(
      new Request("http://localhost/", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }),
    );
    expect(authed).not.toBeInstanceOf(Response);
    expect((authed as User).username).toBe("admin");
  });

  it("requireUser rejects a missing cookie", async () => {
    const result = await requireUser(new Request("http://localhost/"));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("requireUser rejects a valid session for a disabled user", async () => {
    const passwordHash = await hashPassword("temp-pass-2");
    await sql(
      "insert into users (username, password_hash, role, disabled) values ($1, $2, $3, false)",
      ["soon_disabled", passwordHash, "viewer"],
    );
    const rows = await sql<{ id: string }>("select id from users where username = $1", [
      "soon_disabled",
    ]);
    await sql("update users set disabled = true where username = $1", ["soon_disabled"]);
    const result = await requireUser(
      new Request("http://localhost/", {
        headers: { cookie: `${SESSION_COOKIE}=${createSession({ id: rows[0].id })}` },
      }),
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("logout clears the session cookie", async () => {
    const response = await logout();
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
  });

  it("clear cookie includes Secure in production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const header = sessionClearCookie();
      expect(header).toContain("Path=/");
      expect(header.toLowerCase()).toContain("httponly");
      expect(header).toContain("SameSite=Lax");
      expect(header).toContain("Secure");
      expect(header).toContain("Max-Age=0");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
