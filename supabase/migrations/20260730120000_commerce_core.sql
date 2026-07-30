-- Prisma commerce layer — core schema.
--
-- Table and column names deliberately mirror Odoo's own SQL schema
-- (res_partner, sale_order, sale_order_line, product_product,
-- delivery_carrier, payment_transaction, ir_model_data) so the later
-- Supabase -> Odoo move is a 1:1 field map rather than a domain rewrite.
-- See docs/commerce-backend.md §7-bis, principles 2, 3 and 6.
--
-- Fields that have no Odoo counterpart use Odoo's custom-field prefix `x_`,
-- which is exactly what they would become as studio/custom fields there.

-- ---------------------------------------------------------------- helpers
create schema if not exists private;

-- Odoo keeps create_date / write_date on every model; mirror that.
create or replace function private.touch_write_date()
returns trigger
language plpgsql
as $$
begin
  new.write_date := now();
  return new;
end;
$$;

-- ------------------------------------------------------- ir_model_data
-- Stable external IDs (principle 2). Every row we create gets one, so a
-- later Odoo import is idempotent and re-runnable: `module.name` maps
-- straight onto Odoo's own ir.model.data XML-IDs.
create table public.ir_model_data (
  id          bigint generated always as identity primary key,
  module      text not null default 'prisma',
  name        text not null,
  model       text not null,
  res_id      bigint not null,
  noupdate    boolean not null default false,
  create_date timestamptz not null default now(),
  constraint ir_model_data_module_name_key unique (module, name)
);
create index ir_model_data_model_res_id_idx on public.ir_model_data (model, res_id);

comment on table public.ir_model_data is
  'External IDs for every commerce row, mirroring Odoo ir.model.data so imports are idempotent.';

-- ---------------------------------------------------------- res_partner
-- Customers, their delivery/invoice addresses AND pickup partners all live
-- here — Odoo models every one of those as a res.partner, with addresses as
-- child records (parent_id + type).
create table public.res_partner (
  id           bigint generated always as identity primary key,
  ref          text unique,
  name         text not null,
  is_company   boolean not null default false,
  parent_id    bigint references public.res_partner (id) on delete set null,
  type         text not null default 'contact'
                 check (type in ('contact', 'invoice', 'delivery', 'other')),
  email        text,
  phone        text,
  mobile       text,
  street       text,
  street2      text,
  zip          text,
  city         text,
  state_name   text,
  country_code text default 'CH',
  lang         text default 'de_CH',
  customer_rank int not null default 0,
  supplier_rank int not null default 0,
  partner_latitude  double precision,
  partner_longitude double precision,
  comment      text,
  active       boolean not null default true,

  -- Supabase-only bridge: links a partner to its Auth user once accounts ship.
  auth_user_id uuid references auth.users (id) on delete set null,

  -- Prisma custom fields (Odoo `x_` convention).
  x_wa_opt_in         boolean not null default false,
  x_newsletter_opt_in boolean not null default false,
  x_is_pickup_partner boolean not null default false,
  x_pickup_confirmed  boolean not null default false,
  x_commission_pct    numeric(5, 2),

  create_date timestamptz not null default now(),
  write_date  timestamptz not null default now()
);
create unique index res_partner_contact_email_key
  on public.res_partner (lower(email)) where type = 'contact' and email is not null;
create index res_partner_parent_id_idx on public.res_partner (parent_id);
create index res_partner_auth_user_id_idx on public.res_partner (auth_user_id);
create index res_partner_pickup_idx
  on public.res_partner (x_pickup_confirmed) where x_is_pickup_partner;

create trigger res_partner_write_date before update on public.res_partner
  for each row execute function private.touch_write_date();

comment on column public.res_partner.type is
  'Odoo address type: contact = the customer, delivery/invoice = child addresses.';

-- ------------------------------------------------------ product_product
-- The configurator itself stays in src/data/products.ts; this is the sellable
-- product each order line points at, so lines carry a real product_id the way
-- Odoo sale.order.line does.
create table public.product_product (
  id            bigint generated always as identity primary key,
  default_code  text unique,
  name          text not null,
  categ_name    text,
  type          text not null default 'consu'
                  check (type in ('consu', 'service', 'product')),
  list_price    numeric(12, 2) not null default 0,
  currency_name text not null default 'CHF',
  active        boolean not null default true,
  create_date   timestamptz not null default now(),
  write_date    timestamptz not null default now()
);
create trigger product_product_write_date before update on public.product_product
  for each row execute function private.touch_write_date();

-- ----------------------------------------------------- delivery_carrier
create table public.delivery_carrier (
  id            bigint generated always as identity primary key,
  name          text not null,
  delivery_type text not null default 'fixed',
  fixed_price   numeric(12, 2) not null default 0,
  product_id    bigint references public.product_product (id),
  active        boolean not null default true,
  -- the value the storefront posts as `method`
  x_code        text not null unique,
  create_date   timestamptz not null default now(),
  write_date    timestamptz not null default now()
);
create trigger delivery_carrier_write_date before update on public.delivery_carrier
  for each row execute function private.touch_write_date();

-- ------------------------------------------------------------ sale_order
-- Order numbers follow the existing offline convention (orders/PRI00001).
create sequence public.sale_order_name_seq start with 2;

create table public.sale_order (
  id   bigint generated always as identity primary key,
  name text not null unique
         default ('PRI' || lpad(nextval('public.sale_order_name_seq')::text, 5, '0')),
  partner_id          bigint not null references public.res_partner (id),
  partner_invoice_id  bigint references public.res_partner (id),
  partner_shipping_id bigint references public.res_partner (id),
  state text not null default 'draft'
          check (state in ('draft', 'sent', 'sale', 'done', 'cancel')),
  date_order    timestamptz not null default now(),
  currency_name text not null default 'CHF',
  amount_untaxed numeric(12, 2) not null default 0,
  amount_tax     numeric(12, 2) not null default 0,
  amount_total   numeric(12, 2) not null default 0,
  carrier_id       bigint references public.delivery_carrier (id),
  client_order_ref text,
  note             text,

  -- Prisma custom fields.
  -- Odoo would derive fulfilment from stock.picking; until then it is a plain
  -- state column so the storefront/admin has one thing to read.
  x_pickup_partner_id bigint references public.res_partner (id),
  x_fulfilment_state  text not null default 'pending'
    check (x_fulfilment_state in ('pending', 'in_assembly', 'ready', 'shipped',
                                  'delivered', 'returned', 'cancelled')),
  x_update_channel text not null default 'email',
  x_paid_at        timestamptz,

  create_date timestamptz not null default now(),
  write_date  timestamptz not null default now()
);
create index sale_order_partner_id_idx on public.sale_order (partner_id);
create index sale_order_date_order_idx on public.sale_order (date_order desc);

create trigger sale_order_write_date before update on public.sale_order
  for each row execute function private.touch_write_date();

comment on column public.sale_order.state is
  'Odoo sale.order state. A paid Stripe checkout lands as ''sale'' (confirmed order).';

-- ------------------------------------------------------- sale_order_line
create table public.sale_order_line (
  id       bigint generated always as identity primary key,
  order_id bigint not null references public.sale_order (id) on delete cascade,
  sequence int not null default 10,
  product_id      bigint references public.product_product (id),
  name            text not null,
  product_uom_qty numeric(12, 3) not null default 1,
  price_unit      numeric(12, 2) not null default 0,
  tax_rate        numeric(5, 2) not null default 0,
  price_subtotal  numeric(12, 2) not null default 0,
  price_total     numeric(12, 2) not null default 0,
  -- Odoo splits these across product vs delivery lines too.
  x_line_type text not null default 'product'
    check (x_line_type in ('product', 'delivery', 'discount')),
  -- The chosen build (size/colour/drivetrain/pedals). In Odoo this becomes
  -- product attribute values / a BOM; keeping it structured makes that mapping
  -- mechanical rather than archaeological.
  x_config jsonb not null default '{}'::jsonb,
  create_date timestamptz not null default now(),
  write_date  timestamptz not null default now()
);
create index sale_order_line_order_id_idx on public.sale_order_line (order_id);

create trigger sale_order_line_write_date before update on public.sale_order_line
  for each row execute function private.touch_write_date();

-- ---------------------------------------------------- payment_transaction
-- Stripe is the constant across the migration (principle 5): keep the session
-- and payment-intent IDs so Odoo can reconcile against the same payments.
create table public.payment_transaction (
  id        bigint generated always as identity primary key,
  reference text not null unique,
  provider_code      text not null default 'stripe',
  provider_reference text unique,
  x_payment_intent   text,
  amount        numeric(12, 2) not null default 0,
  currency_name text not null default 'CHF',
  state text not null default 'draft'
          check (state in ('draft', 'pending', 'authorized', 'done', 'cancel', 'error')),
  partner_id    bigint references public.res_partner (id),
  sale_order_id bigint references public.sale_order (id) on delete set null,
  create_date timestamptz not null default now(),
  write_date  timestamptz not null default now()
);
create index payment_transaction_sale_order_id_idx
  on public.payment_transaction (sale_order_id);

create trigger payment_transaction_write_date before update on public.payment_transaction
  for each row execute function private.touch_write_date();

comment on column public.payment_transaction.provider_reference is
  'Stripe Checkout Session id — also the idempotency key for order capture.';

-- ------------------------------------------------------------------- RLS
-- Everything is deny-by-default. The order path runs through the service role
-- (which bypasses RLS); the policies below only open up the read paths a
-- signed-in customer needs once Auth ships.
alter table public.ir_model_data       enable row level security;
alter table public.res_partner         enable row level security;
alter table public.product_product     enable row level security;
alter table public.delivery_carrier    enable row level security;
alter table public.sale_order          enable row level security;
alter table public.sale_order_line     enable row level security;
alter table public.payment_transaction enable row level security;

-- Which partners does the signed-in user own? SECURITY DEFINER (and parked in
-- the unexposed `private` schema) so policies that reference res_partner do
-- not recurse into res_partner's own policy.
create or replace function private.my_partner_ids()
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.res_partner where auth_user_id = (select auth.uid())
$$;
revoke all on function private.my_partner_ids() from public;
-- Policy expressions run as the querying role, so `authenticated` needs to be
-- able to call it. It only ever returns that caller's own partner ids.
grant usage on schema private to authenticated;
grant execute on function private.my_partner_ids() to authenticated;

-- Catalog is public information.
create policy product_product_read_active on public.product_product
  for select to anon, authenticated using (active);
create policy delivery_carrier_read_active on public.delivery_carrier
  for select to anon, authenticated using (active);

-- A customer sees their own contact record, their own addresses, and
-- confirmed pickup partners (which the storefront needs to render).
create policy res_partner_read_own on public.res_partner
  for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    or parent_id in (select private.my_partner_ids())
  );
create policy res_partner_read_pickup on public.res_partner
  for select to anon, authenticated
  using (x_is_pickup_partner and x_pickup_confirmed and active);

create policy sale_order_read_own on public.sale_order
  for select to authenticated
  using (partner_id in (select private.my_partner_ids()));

create policy sale_order_line_read_own on public.sale_order_line
  for select to authenticated
  using (order_id in (select id from public.sale_order));

create policy payment_transaction_read_own on public.payment_transaction
  for select to authenticated
  using (partner_id in (select private.my_partner_ids()));
