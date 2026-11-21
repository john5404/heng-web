import { requireRole, requireUser, type User } from "@/lib/auth";
import { sql } from "@/lib/db";

type AuditRow = {
  id: string;
  user_id: string | null;
  username: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  created_at: Date | string;
};

function isResponse(value: User | Response): value is Response {
  return value instanceof Response;
}

function asIso(value: Date | string): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (isResponse(user)) return user;
  const admin = requireRole(user, ["admin"]);
  if (isResponse(admin)) return admin;

  const raw = new URL(request.url).searchParams.get("limit");
  const parsed = raw && /^\d+$/.test(raw) ? Number(raw) : 100;
  const limit = Math.min(200, Math.max(1, parsed));

  const rows = await sql<AuditRow>(
    `select a.id, a.user_id, u.username, a.action, a.entity, a.entity_id, a.before, a.after, a.created_at
     from audit_logs a
     left join users u on u.id = a.user_id
     order by a.created_at desc, a.id desc
     limit $1`,
    [limit],
  );

  return Response.json({
    logs: rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      username: row.username,
      action: row.action,
      entity: row.entity,
      entity_id: row.entity_id,
      before: row.before,
      after: row.after,
      created_at: asIso(row.created_at),
    })),
  });
}
