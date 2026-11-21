-- 單點 prices are stored per portion. Older rows stored the line total.
update addons
set price = price / quantity
where quantity > 0 and mod(price, quantity) = 0;

-- One deposit covers the whole order. Fold any 單點 deposit into it.
update order_items as oi
set amount_paid = oi.amount_paid + coalesce((
  select sum(a.amount_paid)
  from addons as a
  where a.parent_order_item_id = oi.id
    and a.deleted_at is null
), 0)
where exists (
  select 1
  from addons as a
  where a.parent_order_item_id = oi.id
    and a.deleted_at is null
    and a.amount_paid <> 0
);

update addons
set amount_paid = 0
where deleted_at is null and amount_paid <> 0;
