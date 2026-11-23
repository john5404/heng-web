import { sql } from "./db";

export const LOGIN_LOCK_MESSAGE = "嘗試次數過多，請稍後再試";

const ACCOUNT_FAILURES = 5;
const IP_ATTEMPTS = 10;

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim() ?? "";
  if (first) return first.slice(0, 64);
  const real = request.headers.get("x-real-ip")?.trim() ?? "";
  if (real) return real.slice(0, 64);
  return "unknown";
}

/** True when this IP already used its 10 attempts in the last minute. */
export async function ipLimitReached(ip: string): Promise<boolean> {
  await sql("delete from login_ip_attempts where attempted_at < now() - interval '1 minute'");
  const rows = await sql<{ n: number | string }>(
    `select count(*)::int as n
     from login_ip_attempts
     where ip = $1 and attempted_at >= now() - interval '1 minute'`,
    [ip],
  );
  if (Number(rows[0]?.n ?? 0) >= IP_ATTEMPTS) return true;
  await sql("insert into login_ip_attempts (ip) values ($1)", [ip]);
  return false;
}

export async function accountIsLocked(username: string): Promise<boolean> {
  const rows = await sql<{ locked: boolean }>(
    `select locked_until is not null and locked_until > now() as locked
     from login_account_limits
     where username = $1`,
    [username],
  );
  return Boolean(rows[0]?.locked);
}

/** Count one failed password. The fifth failure in a row locks the name for 15 minutes. */
export async function recordAccountFailure(username: string): Promise<void> {
  await sql(
    `insert into login_account_limits (username, failures, locked_until)
     values ($1, 1, null)
     on conflict (username) do update
     set failures = case
           when login_account_limits.locked_until is not null
            and login_account_limits.locked_until <= now() then 1
           else login_account_limits.failures + 1
         end,
         locked_until = case
           when (
             case
               when login_account_limits.locked_until is not null
                and login_account_limits.locked_until <= now() then 1
               else login_account_limits.failures + 1
             end
           ) >= $2 then now() + interval '15 minutes'
           else null
         end`,
    [username, ACCOUNT_FAILURES],
  );
}

export async function clearAccountFailures(username: string): Promise<void> {
  await sql("delete from login_account_limits where username = $1", [username]);
}
