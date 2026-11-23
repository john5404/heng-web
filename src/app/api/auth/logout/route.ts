import { revokeSessionCookie, sessionClearCookie } from "@/lib/auth";

export async function POST(request: Request): Promise<Response> {
  await revokeSessionCookie(request);
  const response = Response.json({ ok: true });
  response.headers.set("Set-Cookie", sessionClearCookie());
  return response;
}
