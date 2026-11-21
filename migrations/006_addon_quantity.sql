alter table addons add column quantity integer not null default 1;

alter table addons add constraint addons_quantity_positive check (quantity >= 1);
