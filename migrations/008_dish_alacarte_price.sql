alter table dishes add column alacarte_price integer not null default 0;
alter table dishes add constraint dishes_alacarte_price_nonnegative check (alacarte_price >= 0);

update dishes as d
set alacarte_price = ms.price
from set_dishes sd
join menu_sets ms on ms.id = sd.menu_set_id
where d.id = sd.dish_id
  and ms.name = '單點上湯魚翅羹';

delete from set_dishes
where menu_set_id in (select id from menu_sets where name = '單點上湯魚翅羹')
  and not exists (
    select 1
    from order_items oi
    join menu_sets ms on ms.id = oi.menu_set_id
    where ms.name = '單點上湯魚翅羹'
  );

delete from menu_sets
where name = '單點上湯魚翅羹'
  and not exists (
    select 1 from order_items oi where oi.menu_set_id = menu_sets.id
  );
