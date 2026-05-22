-- ─── Customers: first-class Stripe IDs + retention fields ────────────────
--
-- Before this migration the customers table stored none of:
--   * stripe_customer_id        (the canonical Stripe link)
--   * stripe_subscription_id    (the active Glow membership sub, if any)
--   * lifetime_revenue_cents    (cached retention metric)
--   * total_bookings            (cached retention metric)
--   * completed_bookings        (cached retention metric)
--   * first_service_at          (cached retention metric)
--   * lifecycle_stage           (lead / new_customer / recurring / vip / churned)
--   * churn_risk                (Low / Medium / High / Unknown)
--
-- send-zapier-webhook + ghl-field-map.ts already COMPUTE these on every
-- booking sync by re-querying bookings + Stripe, but having them on the
-- customers row directly:
--
--   1. lets admin / VA tools see retention without round-tripping GHL
--   2. lets us push a customer-level GHL sync (not just booking-level)
--   3. keeps the data in one canonical place for analytics

alter table public.customers
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists lifetime_revenue_cents bigint default 0,
  add column if not exists total_bookings integer default 0,
  add column if not exists completed_bookings integer default 0,
  add column if not exists first_service_at timestamptz,
  add column if not exists lifecycle_stage text,
  add column if not exists churn_risk text;

create index if not exists customers_stripe_customer_id_idx
  on public.customers (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists customers_lifecycle_stage_idx
  on public.customers (lifecycle_stage)
  where lifecycle_stage is not null;

-- Lifecycle-stage helper. Pure derivation; safe to call from triggers.
create or replace function public.derive_customer_lifecycle_stage(
  p_total_bookings integer,
  p_completed_bookings integer,
  p_lifetime_revenue_cents bigint,
  p_membership_status text,
  p_last_booking_at timestamptz
) returns text
language plpgsql
immutable
as $$
declare
  days_since_last numeric;
begin
  -- VIP first — anything north of $1500 lifetime OR an active membership +
  -- 3+ completed jobs is VIP.
  if coalesce(p_lifetime_revenue_cents,0) >= 150000 then return 'vip'; end if;
  if coalesce(p_membership_status,'') in ('active','past_due')
     and coalesce(p_completed_bookings,0) >= 3 then return 'vip'; end if;

  -- Churned — last booking older than 120 days OR membership cancelled
  if p_last_booking_at is not null then
    days_since_last := extract(epoch from (now() - p_last_booking_at)) / 86400;
    if days_since_last >= 120 then return 'churned'; end if;
  end if;
  if coalesce(p_membership_status,'') in ('cancelled','expired') then
    return 'churned';
  end if;

  -- Recurring — 2+ completed jobs
  if coalesce(p_completed_bookings,0) >= 2 then return 'recurring'; end if;

  -- New customer — 1 booking (any status)
  if coalesce(p_total_bookings,0) >= 1 then return 'new_customer'; end if;

  return 'lead';
end;
$$;

-- One-shot back-fill / refresh. Re-runnable. Pass NULL for p_customer_id
-- to refresh every customer row.
create or replace function public.refresh_customer_retention(
  p_customer_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  -- bookings.customer_id stores the Stripe customer id (text, "cus_…"),
  -- not a UUID FK back to customers.id. Bridge the two via lower(email)
  -- which is the only stable join key across both tables today.
  with agg as (
    select
      c.id as customer_id,
      coalesce(count(b.*) filter (where b.id is not null), 0) as total_bookings,
      coalesce(count(b.*) filter (where b.status = 'completed'), 0) as completed_bookings,
      coalesce(sum(coalesce(b.final_charge_cents, b.total_estimate_cents))
                 filter (where b.status = 'completed'), 0) as lifetime_revenue_cents,
      max(b.completed_at) filter (where b.status = 'completed') as last_completed_at,
      min(b.completed_at) filter (where b.status = 'completed') as first_completed_at,
      max(b.created_at) as last_any_booking_at,
      max(b.customer_id) filter (where b.customer_id like 'cus_%') as derived_stripe_customer_id
    from public.customers c
    left join public.bookings b on lower(b.email) = lower(c.email)
    where p_customer_id is null or c.id = p_customer_id
    group by c.id
  )
  update public.customers c
  set total_bookings         = agg.total_bookings,
      completed_bookings     = agg.completed_bookings,
      lifetime_revenue_cents = agg.lifetime_revenue_cents,
      first_service_at       = coalesce(agg.first_completed_at, c.first_service_at),
      last_booking_at        = coalesce(agg.last_completed_at, agg.last_any_booking_at, c.last_booking_at),
      lifecycle_stage        = public.derive_customer_lifecycle_stage(
        agg.total_bookings::int,
        agg.completed_bookings::int,
        agg.lifetime_revenue_cents::bigint,
        c.membership_status,
        coalesce(agg.last_completed_at, agg.last_any_booking_at, c.last_booking_at)
      ),
      stripe_customer_id     = coalesce(c.stripe_customer_id, agg.derived_stripe_customer_id),
      updated_at             = now()
  from agg
  where c.id = agg.customer_id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.refresh_customer_retention(uuid) is
  'Back-fills customers.total_bookings, completed_bookings, lifetime_revenue_cents, first_service_at, last_booking_at, stripe_customer_id (derived from bookings), and lifecycle_stage from the bookings table. Pass NULL to refresh every customer; pass a specific customer_id to refresh only that row. Joins bookings to customers on lower(email).';
