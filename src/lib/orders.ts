import type { SqlFn } from "./db";
import { isPaidInFull, remainingAmount } from "./money";

export const DEFAULT_AMOUNT_PAID = 2000;
export const SOUP_DISH_NAME = "上湯魚翅羹";
export const SOUP_SET_NAME = "單點上湯魚翅羹";

/** Deposit default is 2000, but never more than the price (a 1700 soup is paid in full). */
export function defaultAmountPaid(price: number): number {
  return price < DEFAULT_AMOUNT_PAID ? price : DEFAULT_AMOUNT_PAID;
}

export type OrderRow = {
  id: string;
  customer_name: string;
  phone: string;
  service_type: string;
  menu_set_id: string | null;
  menu_set_name: string | null;
  slot_id: string;
  service_date: string;
  slot_label: string;
  start_time: string;
  end_time: string;
  price: number | string;
  amount_paid: number | string;
  picked_up: boolean;
  note: string;
};

export type AddonRow = {
  id: string;
  parent_order_item_id: string;
  dish_id: string;
  dish_name: string;
  price: number | string;
  amount_paid: number | string;
  picked_up: boolean;
};

export type AddonJson = {
  id: string;
  parent_order_item_id: string;
  dish_id: string;
  dish_name: string;
  price: number;
  amount_paid: number;
  remaining: number;
  paid_in_full: boolean;
  picked_up: boolean;
};

export type OrderJson = {
  id: string;
  customer_name: string;
  phone: string;
  service_type: string;
  menu_set_id: string | null;
  menu_set_name: string | null;
  slot_id: string;
  service_date: string;
  slot_label: string;
  start_time: string;
  end_time: string;
  price: number;
  amount_paid: number;
  remaining: number;
  paid_in_full: boolean;
  picked_up: boolean;
  note: string;
  addons: AddonJson[];
};

export const ORDER_SELECT = `select oi.id, oi.customer_name, oi.phone, oi.service_type,
  oi.menu_set_id, ms.name as menu_set_name, oi.slot_id,
  to_char(ds.service_date, 'YYYY-MM-DD') as service_date,
  ds.label as slot_label,
  to_char(ds.start_time, 'HH24:MI:SS') as start_time,
  to_char(ds.end_time, 'HH24:MI:SS') as end_time,
  oi.price, oi.amount_paid, oi.picked_up, oi.note
from order_items oi
join day_slots ds on ds.id = oi.slot_id
left join menu_sets ms on ms.id = oi.menu_set_id`;

export const ADDON_SELECT = `select a.id, a.parent_order_item_id, a.dish_id, d.name as dish_name,
  a.price, a.amount_paid, a.picked_up
from addons a
join dishes d on d.id = a.dish_id`;

export function serializeAddon(row: AddonRow): AddonJson {
  const price = Number(row.price);
  const amountPaid = Number(row.amount_paid);
  return {
    id: row.id,
    parent_order_item_id: row.parent_order_item_id,
    dish_id: row.dish_id,
    dish_name: row.dish_name,
    price,
    amount_paid: amountPaid,
    remaining: remainingAmount(price, amountPaid),
    paid_in_full: isPaidInFull(price, amountPaid),
    picked_up: Boolean(row.picked_up),
  };
}

export async function attachAddons(query: SqlFn, orders: OrderJson[]): Promise<OrderJson[]> {
  if (orders.length === 0) return orders;
  const placeholders = orders.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await query<AddonRow>(
    `${ADDON_SELECT}
     where a.deleted_at is null and a.parent_order_item_id in (${placeholders})
     order by a.created_at, a.id`,
    orders.map((order) => order.id),
  );
  const grouped = new Map<string, AddonJson[]>();
  for (const row of rows) {
    const list = grouped.get(row.parent_order_item_id) ?? [];
    list.push(serializeAddon(row));
    grouped.set(row.parent_order_item_id, list);
  }
  return orders.map((order) => ({ ...order, addons: grouped.get(order.id) ?? [] }));
}

export function serializeOrder(row: OrderRow): OrderJson {
  const price = Number(row.price);
  const amountPaid = Number(row.amount_paid);
  return {
    id: row.id,
    customer_name: row.customer_name,
    phone: row.phone,
    service_type: row.service_type,
    menu_set_id: row.menu_set_id,
    menu_set_name: row.menu_set_name,
    slot_id: row.slot_id,
    service_date: String(row.service_date).slice(0, 10),
    slot_label: row.slot_label,
    start_time: String(row.start_time).slice(0, 8),
    end_time: String(row.end_time).slice(0, 8),
    price,
    amount_paid: amountPaid,
    remaining: remainingAmount(price, amountPaid),
    paid_in_full: isPaidInFull(price, amountPaid),
    picked_up: Boolean(row.picked_up),
    note: row.note ?? "",
    addons: [],
  };
}

export type PriceTierCount = {
  name: string;
  price: number;
  count: number;
};

/** null tier means every order. Otherwise keep one 年菜價格 name. */
export function ordersMatchingTier<T extends { menu_set_name: string | null }>(
  orders: T[],
  tier: string | null,
): T[] {
  if (!tier) return orders;
  return orders.filter((order) => (order.menu_set_name ?? "未選套餐") === tier);
}

/** Count selected-slot orders by 年菜價格. Addons are not separate tiers. */
export function priceTierCounts(
  orders: { menu_set_name: string | null; price: number }[],
): PriceTierCount[] {
  const grouped = new Map<string, PriceTierCount>();
  for (const order of orders) {
    const name = order.menu_set_name ?? "未選套餐";
    const key = `${name}\0${order.price}`;
    const row = grouped.get(key) ?? { name, price: order.price, count: 0 };
    row.count += 1;
    grouped.set(key, row);
  }
  return [...grouped.values()].sort(
    (a, b) => b.price - a.price || a.name.localeCompare(b.name, "zh-Hant"),
  );
}

export function nameSearchPattern(query: string): string {
  const escaped = query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}
