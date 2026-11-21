create table order_set_dish_prices (
  order_item_id uuid not null references order_items (id),
  dish_id uuid not null references dishes (id),
  price integer not null,
  primary key (order_item_id, dish_id),
  constraint order_set_dish_prices_price_nonnegative check (price >= 0)
);
