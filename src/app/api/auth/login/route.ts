import { createSession, loginWithPassword, sessionSetCookie } from "@/lib/auth";

export async function POST(request: Request): Promise<Response> {
  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { username?: unknown; password?: unknown };
  } catch {
    return Response.json({ error: "帳號或密碼錯誤" }, { status: 401 });
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return Response.json({ error: "帳號或密碼錯誤" }, { status: 401 });
  }
  const user = await loginWithPassword(username, password);
  if (!user) {
    return Response.json({ error: "帳號或密碼錯誤" }, { status: 401 });
  }
  const response = Response.json({
    ok: true,
    user: { id: user.id, username: user.username, role: user.role },
  });
  response.headers.set("Set-Cookie", sessionSetCookie(createSession(user)));
  return response;
}
