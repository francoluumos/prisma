-- The single order sink (docs/commerce-backend.md §7-bis, principle 1).
--
-- Every order write in the system goes through public.create_order(jsonb).
-- Nothing else inserts into sale_order. Migrating to Odoo therefore means
-- reimplementing this one entry point against Odoo's API — the storefront and
-- the Stripe webhook do not change.
--
-- Idempotent on the Stripe Checkout Session id, because Stripe retries
-- webhooks: calling it twice with the same session returns the first order.

-- Attach a stable external ID to a row (no-op if it already has one).
create or replace function private.ensure_xmlid(p_model text, p_res_id bigint, p_name text)
returns void
language sql
as $$
  insert into public.ir_model_data (module, name, model, res_id)
  values ('prisma', p_name, p_model, p_res_id)
  on conflict (module, name) do nothing;
$$;

-- Find-or-create a child address (delivery / invoice) under a customer.
create or replace function private.ensure_address(
  p_parent_id bigint,
  p_type      text,
  p_addr      jsonb
)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  if p_addr is null or coalesce(p_addr ->> 'street', '') = '' then
    return null;
  end if;

  select id into v_id
  from public.res_partner
  where parent_id = p_parent_id
    and type = p_type
    and coalesce(street, '') = coalesce(p_addr ->> 'street', '')
    and coalesce(zip, '')    = coalesce(p_addr ->> 'zip', '')
    and coalesce(city, '')   = coalesce(p_addr ->> 'city', '')
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.res_partner (name, parent_id, type, street, street2, zip, city,
                                  country_code, email, phone)
  values (coalesce(nullif(p_addr ->> 'name', ''), 'Address'),
          p_parent_id, p_type,
          p_addr ->> 'street', p_addr ->> 'street2', p_addr ->> 'zip', p_addr ->> 'city',
          coalesce(nullif(p_addr ->> 'country_code', ''), 'CH'),
          nullif(p_addr ->> 'email', ''), nullif(p_addr ->> 'phone', ''))
  returning id into v_id;

  perform private.ensure_xmlid('res.partner', v_id, 'res_partner_' || v_id);
  return v_id;
end;
$$;

-- ------------------------------------------------------------ create_order
-- SECURITY INVOKER on purpose: the only caller is the service role, which
-- bypasses RLS. A SECURITY DEFINER here would both widen the blast radius and
-- lose that bypass.
create or replace function public.create_order(payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_session      text := payload ->> 'stripe_session_id';
  v_customer     jsonb := coalesce(payload -> 'customer', '{}'::jsonb);
  v_email        text := lower(nullif(trim(v_customer ->> 'email'), ''));
  v_partner_id   bigint;
  v_ship_id      bigint;
  v_invoice_id   bigint;
  v_pickup_id    bigint;
  v_carrier_id   bigint;
  v_order_id     bigint;
  v_order_name   text;
  v_pickup       jsonb := payload -> 'pickup_partner';
  v_line         jsonb;
  v_seq          int := 10;
  v_total        numeric := coalesce((payload ->> 'amount_total')::numeric, 0);
  v_tax          numeric := coalesce((payload ->> 'amount_tax')::numeric, 0);
  v_existing     bigint;
begin
  if v_session is null or v_session = '' then
    raise exception 'create_order: stripe_session_id is required';
  end if;
  if v_email is null then
    raise exception 'create_order: customer.email is required';
  end if;

  -- Idempotency: Stripe retries webhooks, and a retry must not duplicate.
  select sale_order_id into v_existing
  from public.payment_transaction
  where provider_reference = v_session;

  if v_existing is not null then
    select name into v_order_name from public.sale_order where id = v_existing;
    return jsonb_build_object('order_id', v_existing, 'order_name', v_order_name,
                              'created', false);
  end if;

  -- ---- customer (res.partner, type 'contact') --------------------------
  select id into v_partner_id
  from public.res_partner
  where type = 'contact' and lower(email) = v_email;

  if v_partner_id is null then
    insert into public.res_partner (name, type, email, phone, customer_rank,
                                    x_wa_opt_in, x_newsletter_opt_in)
    values (coalesce(nullif(trim(v_customer ->> 'name'), ''), v_email),
            'contact', v_email, nullif(v_customer ->> 'phone', ''), 1,
            coalesce((v_customer ->> 'wa_opt_in')::boolean, false),
            coalesce((v_customer ->> 'newsletter_opt_in')::boolean, false))
    returning id into v_partner_id;

    perform private.ensure_xmlid('res.partner', v_partner_id,
                                 'res_partner_' || v_partner_id);
  else
    update public.res_partner
    set name  = coalesce(nullif(trim(v_customer ->> 'name'), ''), name),
        phone = coalesce(nullif(v_customer ->> 'phone', ''), phone),
        customer_rank = customer_rank + 1,
        x_wa_opt_in = x_wa_opt_in
                      or coalesce((v_customer ->> 'wa_opt_in')::boolean, false),
        x_newsletter_opt_in = x_newsletter_opt_in
                      or coalesce((v_customer ->> 'newsletter_opt_in')::boolean, false)
    where id = v_partner_id;
  end if;

  -- ---- addresses -------------------------------------------------------
  v_ship_id := private.ensure_address(v_partner_id, 'delivery',
                                      payload -> 'delivery_address');
  v_invoice_id := private.ensure_address(v_partner_id, 'invoice',
                                         payload -> 'invoice_address');
  -- "Same as delivery" — Odoo points both at the customer's address too.
  if v_invoice_id is null then
    v_invoice_id := coalesce(v_ship_id, v_partner_id);
  end if;

  -- ---- carrier + pickup partner ---------------------------------------
  select id into v_carrier_id
  from public.delivery_carrier
  where x_code = coalesce(payload ->> 'method', 'home');

  if v_pickup is not null and coalesce(v_pickup ->> 'name', '') <> '' then
    select id into v_pickup_id
    from public.res_partner
    where x_is_pickup_partner
      and name = v_pickup ->> 'name'
      and coalesce(city, '') = coalesce(v_pickup ->> 'city', '');

    if v_pickup_id is null then
      -- Proposed, not yet a confirmed Prisma partner (mirrors the storefront).
      insert into public.res_partner (name, type, is_company, street, zip, city,
                                      partner_latitude, partner_longitude,
                                      x_is_pickup_partner, x_pickup_confirmed)
      values (v_pickup ->> 'name', 'contact', true,
              v_pickup ->> 'street', v_pickup ->> 'zip', v_pickup ->> 'city',
              (v_pickup ->> 'lat')::double precision,
              (v_pickup ->> 'lon')::double precision,
              true, false)
      returning id into v_pickup_id;

      perform private.ensure_xmlid('res.partner', v_pickup_id,
                                   'res_partner_' || v_pickup_id);
    end if;
  end if;

  -- ---- the order -------------------------------------------------------
  insert into public.sale_order (partner_id, partner_invoice_id, partner_shipping_id,
                                 state, date_order, currency_name,
                                 amount_untaxed, amount_tax, amount_total,
                                 carrier_id, client_order_ref, note,
                                 x_pickup_partner_id, x_fulfilment_state,
                                 x_update_channel, x_paid_at)
  values (v_partner_id, v_invoice_id, coalesce(v_ship_id, v_partner_id),
          'sale', coalesce((payload ->> 'date_order')::timestamptz, now()),
          coalesce(nullif(payload ->> 'currency', ''), 'CHF'),
          v_total - v_tax, v_tax, v_total,
          v_carrier_id, nullif(payload ->> 'client_order_ref', ''),
          nullif(payload ->> 'note', ''),
          v_pickup_id, 'pending',
          coalesce(nullif(payload ->> 'update_channel', ''), 'email'),
          coalesce((payload ->> 'paid_at')::timestamptz, now()))
  returning id, name into v_order_id, v_order_name;

  perform private.ensure_xmlid('sale.order', v_order_id, 'sale_order_' || v_order_name);

  -- ---- lines -----------------------------------------------------------
  for v_line in select * from jsonb_array_elements(coalesce(payload -> 'lines', '[]'::jsonb))
  loop
    insert into public.sale_order_line (order_id, sequence, product_id, name,
                                        product_uom_qty, price_unit, tax_rate,
                                        price_subtotal, price_total,
                                        x_line_type, x_config)
    values (v_order_id, v_seq,
            (select id from public.product_product
              where default_code = v_line ->> 'product_code'),
            coalesce(nullif(v_line ->> 'name', ''), 'Item'),
            coalesce((v_line ->> 'qty')::numeric, 1),
            coalesce((v_line ->> 'price_unit')::numeric, 0),
            coalesce((v_line ->> 'tax_rate')::numeric, 0),
            coalesce((v_line ->> 'price_subtotal')::numeric,
                     (v_line ->> 'price_total')::numeric, 0),
            coalesce((v_line ->> 'price_total')::numeric, 0),
            coalesce(nullif(v_line ->> 'line_type', ''), 'product'),
            coalesce(v_line -> 'config', '{}'::jsonb));
    v_seq := v_seq + 10;
  end loop;

  -- ---- payment ---------------------------------------------------------
  insert into public.payment_transaction (reference, provider_code, provider_reference,
                                          x_payment_intent, amount, currency_name,
                                          state, partner_id, sale_order_id)
  values (v_order_name, 'stripe', v_session,
          nullif(payload ->> 'payment_intent', ''), v_total,
          coalesce(nullif(payload ->> 'currency', ''), 'CHF'),
          'done', v_partner_id, v_order_id);

  return jsonb_build_object('order_id', v_order_id, 'order_name', v_order_name,
                            'created', true);
end;
$$;

-- Only the service role (the Stripe webhook) may capture orders. Supabase
-- grants EXECUTE to PUBLIC by default on new functions, so revoke first.
revoke all on function public.create_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_order(jsonb) to service_role;

revoke all on function private.ensure_xmlid(text, bigint, text) from public;
revoke all on function private.ensure_address(bigint, text, jsonb) from public;
