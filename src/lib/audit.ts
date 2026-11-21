import { sql, type SqlFn } from "./db";

export async function writeAudit(
  input: {
    userId: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
  },
  query: SqlFn = sql,
): Promise<void> {
  await query(
    `insert into audit_logs (user_id, action, entity, entity_id, before, after)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      input.userId,
      input.action,
      input.entity,
      input.entityId ?? null,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
    ],
  );
}
