create table login_account_limits (
  username text primary key,
  failures integer not null,
  locked_until timestamptz,
  constraint login_account_limits_failures_nonnegative check (failures >= 0)
);

create table login_ip_attempts (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  attempted_at timestamptz not null default now()
);

create index login_ip_attempts_ip_attempted_idx on login_ip_attempts (ip, attempted_at);
