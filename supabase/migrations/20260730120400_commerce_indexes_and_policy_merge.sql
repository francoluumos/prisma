-- Covering indexes for the foreign keys the order/admin views actually join on
-- (Supabase performance linter 0001).
create index if not exists delivery_carrier_product_id_idx
  on public.delivery_carrier (product_id);
create index if not exists payment_transaction_partner_id_idx
  on public.payment_transaction (partner_id);
create index if not exists sale_order_carrier_id_idx
  on public.sale_order (carrier_id);
create index if not exists sale_order_partner_invoice_id_idx
  on public.sale_order (partner_invoice_id);
create index if not exists sale_order_partner_shipping_id_idx
  on public.sale_order (partner_shipping_id);
create index if not exists sale_order_x_pickup_partner_id_idx
  on public.sale_order (x_pickup_partner_id);
create index if not exists sale_order_line_product_id_idx
  on public.sale_order_line (product_id);

-- Two permissive SELECT policies on res_partner meant every read evaluated
-- both (linter 0006). Fold them into one.
drop policy if exists res_partner_read_own on public.res_partner;
drop policy if exists res_partner_read_pickup on public.res_partner;

-- anon evaluates the same expression, so it needs to be able to call the
-- helper — with no session it simply returns no rows.
grant usage on schema private to anon;
grant execute on function private.my_partner_ids() to anon;

create policy res_partner_read on public.res_partner
  for select to anon, authenticated
  using (
    -- confirmed pickup partners are public
    (x_is_pickup_partner and x_pickup_confirmed and active)
    -- your own contact record, and the addresses hanging off it
    or auth_user_id = (select auth.uid())
    or parent_id in (select private.my_partner_ids())
  );
