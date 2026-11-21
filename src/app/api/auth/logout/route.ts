import { sessionClearCookie } from "@/lib/auth";

export async function POST(): Promise<Response> {
  const response = Response.json({ ok: true });
  response.headers.set("Set-Cookie", sessionClearCookie());
  return response;
}
