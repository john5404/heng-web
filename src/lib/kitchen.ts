import { sql } from "./db";

export type DishTotal = {
  dishName: string;
  qty: number;
};

/** Shown on the kitchen screen: prep follows every valid order for the slot. */
export const PREP_NOTE = "備料總量＝該時段有效訂單菜量";

/**
 * 備料總量＝該時段有效訂單菜量。
 * Counts every non-deleted order on the slot, picked up or not, because prep
 * follows what was ordered. Soft-deleted orders and addons are left out.
 * Set dishes are read from live set_dishes, so a menu edit recalculates totals.
 * Addons add one portion of their dish name on top of the set.
 */
export async function dishTotalsForSlot(date: string, slotId: string): Promise<DishTotal[]> {
  const setRows = await sql<{ dish_name: string; qty: number | string }>(
    `select d.name as dish_name, count(*) as qty
     from order_items oi
     join day_slots ds on ds.id = oi.slot_id
     join set_dishes sd on sd.menu_set_id = oi.menu_set_id
     join dishes d on d.id = sd.dish_id
     where oi.deleted_at is null
       and oi.slot_id = $1
       and ds.service_date = $2::date
     group by d.name`,
    [slotId, date],
  );
  const addonRows = await sql<{ dish_name: string; qty: number | string }>(
    `select d.name as dish_name, count(*) as qty
     from addons a
     join dishes d on d.id = a.dish_id
     join order_items oi on oi.id = a.parent_order_item_id
     join day_slots ds on ds.id = oi.slot_id
     where a.deleted_at is null
       and oi.deleted_at is null
       and oi.slot_id = $1
       and ds.service_date = $2::date
     group by d.name`,
    [slotId, date],
  );

  const qtyByName = new Map<string, number>();
  for (const row of [...setRows, ...addonRows]) {
    qtyByName.set(row.dish_name, (qtyByName.get(row.dish_name) ?? 0) + Number(row.qty));
  }
  return [...qtyByName.entries()]
    .map(([dishName, qty]) => ({ dishName, qty }))
    .sort((a, b) => b.qty - a.qty || a.dishName.localeCompare(b.dishName, "zh-Hant"));
}
