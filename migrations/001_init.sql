create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role text not null,
  created_at timestamptz not null default now(),
  constraint users_role_check check (role in ('admin', 'pickup', 'viewer'))
);

create table menu_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price integer not null,
  created_at timestamptz not null default now(),
  constraint menu_sets_price_nonnegative check (price >= 0)
);

create table dishes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table set_dishes (
  menu_set_id uuid not null references menu_sets (id),
  dish_id uuid not null references dishes (id),
  sort_order integer not null default 0,
  primary key (menu_set_id, dish_id)
);

create table day_slots (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  service_type text not null,
  label text not null,
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint day_slots_service_type_check check (service_type in ('takeout', 'dine_in'))
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  phone text not null,
  service_type text not null,
  menu_set_id uuid references menu_sets (id),
  slot_id uuid not null references day_slots (id),
  price integer not null,
  amount_paid integer not null default 0,
  picked_up boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint order_items_service_type_check check (service_type in ('takeout', 'dine_in')),
  constraint order_items_price_nonnegative check (price >= 0),
  constraint order_items_amount_paid_nonnegative check (amount_paid >= 0)
);

create index order_items_customer_name_idx on order_items (customer_name);
create index order_items_slot_id_idx on order_items (slot_id);

create table addons (
  id uuid primary key default gen_random_uuid(),
  parent_order_item_id uuid not null references order_items (id),
  dish_id uuid not null references dishes (id),
  price integer not null,
  amount_paid integer not null default 0,
  picked_up boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint addons_price_nonnegative check (price >= 0),
  constraint addons_amount_paid_nonnegative check (amount_paid >= 0)
);

create index addons_parent_order_item_id_idx on addons (parent_order_item_id);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id),
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_created_at_idx on audit_logs (created_at);
