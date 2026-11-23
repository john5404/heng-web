import { createSession, loginWithPassword, sessionSetCookie } from "@/lib/auth";
import {
  LOGIN_LOCK_MESSAGE,
  accountIsLocked,
  clearAccountFailures,
  clientIp,
  ipLimitReached,
  recordAccountFailure,
} from "@/lib/login-limit";

const BAD_LOGIN = "帳號或密碼錯誤";

export async function POST(request: Request): Promise<Response> {
  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { username?: unknown; password?: unknown };
  } catch {
    return Response.json({ error: BAD_LOGIN }, { status: 401 });
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return Response.json({ error: BAD_LOGIN }, { status: 401 });
  }
  if (await ipLimitReached(clientIp(request))) {
    return Response.json({ error: LOGIN_LOCK_MESSAGE }, { status: 429 });
  }
  if (await accountIsLocked(username)) {
    return Response.json({ error: LOGIN_LOCK_MESSAGE }, { status: 429 });
  }
  const user = await loginWithPassword(username, password);
  if (!user) {
    await recordAccountFailure(username);
    return Response.json({ error: BAD_LOGIN }, { status: 401 });
  }
  await clearAccountFailures(username);
  const response = Response.json({
    ok: true,
    user: { id: user.id, username: user.username, role: user.role },
  });
  response.headers.set("Set-Cookie", sessionSetCookie(await createSession(user)));
  return response;
}
