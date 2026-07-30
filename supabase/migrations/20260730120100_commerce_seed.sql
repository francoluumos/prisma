-- Sellable products and delivery methods.
--
-- The configurator (src/data/products.ts) stays the pricing source of truth;
-- these rows exist so every sale_order_line points at a real product the way
-- Odoo requires, and so the two delivery fees are data rather than literals.
-- `list_price` is the entry price (cheapest drivetrain, no pedals) — the line's
-- own price_unit carries what the customer actually configured.

insert into public.product_product (default_code, name, categ_name, type, list_price)
values
  ('PRISMA-ONE',   'Prisma One',   'Aero road bike — racing', 'consu', 1414),
  ('PRISMA-TERRA', 'Prisma Terra', 'All-road gravel bike',    'consu', 1240),
  ('DELIV-HOME',   'Home delivery',            'Delivery', 'service', 59),
  ('DELIV-PICKUP', 'Pickup at a local partner','Delivery', 'service', 149)
on conflict (default_code) do nothing;

insert into public.delivery_carrier (name, delivery_type, fixed_price, product_id, x_code)
select v.name, 'fixed', v.fee, p.id, v.code
from (values
        ('Home delivery',             59::numeric,  'home',   'DELIV-HOME'),
        ('Pickup at a local partner', 149::numeric, 'pickup', 'DELIV-PICKUP')
     ) as v(name, fee, code, product_code)
join public.product_product p on p.default_code = v.product_code
on conflict (x_code) do nothing;

-- External IDs for the seeded rows, so a later Odoo import updates rather than
-- duplicates them.
insert into public.ir_model_data (module, name, model, res_id, noupdate)
select 'prisma', 'product_' || lower(replace(default_code, '-', '_')),
       'product.product', id, true
from public.product_product
on conflict (module, name) do nothing;

insert into public.ir_model_data (module, name, model, res_id, noupdate)
select 'prisma', 'carrier_' || x_code, 'delivery.carrier', id, true
from public.delivery_carrier
on conflict (module, name) do nothing;
