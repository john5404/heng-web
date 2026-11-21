import { requireUser } from "@/lib/auth";

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  return Response.json({ id: user.id, username: user.username, role: user.role });
}
