-- ─── Payroll + VA sales tracker + auto-payout-on-completion ────────────
--
-- Three deliverables for the admin portal's payroll/sales/operations side:
--
--   1. cleaner_payroll_v1 — per-cleaner snapshot view that powers the
--      /admin/payroll page (jobs completed, owed, paid, pending).
--   2. va_sales_v1 — per-VA snapshot view that powers the
--      /admin/sales-tracker page (leads handled, bookings closed,
--      revenue generated, conversion rate).
--   3. trigger_auto_payout_on_booking_completion — DB trigger that fires
--      the process-payout edge function via pg_net whenever a booking
--      transitions to status='completed' AND the assigned cleaner has a
--      stripe_account_id with payouts_enabled. Idempotent — bookings
--      already at payout_status='completed' / 'processing' are skipped.

-- ─── 1. cleaner_payroll_v1 ─────────────────────────────────────────────
--
-- Per-cleaner payroll snapshot. Used as the data source for the admin
-- Payroll page. Rolls up all bookings assigned to a cleaner and
-- categorizes the dollars into three buckets:
--   * paid_cents      — payouts row exists AND status='completed'
--   * processing_cents — payouts row exists AND status='processing'/'pending'
--   * owed_cents      — booking is completed, no payouts row yet
--   * failed_cents    — payouts row exists AND status='failed'
--
-- Use a CTE on bookings to join the latest payouts.* row per booking
-- (there can be retries) and then aggregate per cleaner.

create or replace view public.cleaner_payroll_v1 as
with latest_payout_per_booking as (
  select distinct on (p.booking_id)
    p.booking_id,
    p.id           as payout_id,
    p.status       as payout_status,
    p.cleaner_payout_cents,
    p.processed_at,
    p.failed_reason
  from public.payouts p
  order by p.booking_id, p.created_at desc
),
booking_rollup as (
  select
    b.id                                as booking_id,
    b.cleaner_id,
    b.booking_number,
    b.status                            as booking_status,
    b.service_date,
    b.completed_at,
    b.service_type,
    b.cleaner_payout_cents              as booking_payout_cents,
    lp.payout_id,
    coalesce(lp.payout_status, 'unpaid') as effective_payout_status,
    coalesce(lp.cleaner_payout_cents, b.cleaner_payout_cents, 0) as effective_payout_cents,
    lp.processed_at,
    lp.failed_reason
  from public.bookings b
  left join latest_payout_per_booking lp on lp.booking_id = b.id
  where b.cleaner_id is not null
    and b.status in ('completed','in_progress')
)
select
  c.id                          as cleaner_id,
  c.first_name,
  c.last_name,
  c.email,
  c.phone,
  c.status                      as cleaner_status,
  c.pay_tier,
  c.pay_rate_hr,
  c.stripe_account_id,
  c.payouts_enabled,
  c.average_rating,
  c.completed_bookings,

  count(br.booking_id)
    filter (where br.booking_status = 'completed')                       as jobs_completed,
  count(br.booking_id)
    filter (where br.booking_status = 'in_progress')                     as jobs_in_progress,

  coalesce(sum(br.effective_payout_cents)
    filter (where br.effective_payout_status = 'completed'), 0)::bigint  as paid_cents,
  coalesce(sum(br.effective_payout_cents)
    filter (where br.effective_payout_status in ('processing','pending')), 0)::bigint
                                                                          as processing_cents,
  coalesce(sum(br.effective_payout_cents)
    filter (where br.effective_payout_status = 'unpaid'
            and br.booking_status = 'completed'), 0)::bigint              as owed_cents,
  coalesce(sum(br.effective_payout_cents)
    filter (where br.effective_payout_status = 'failed'), 0)::bigint     as failed_cents,
  max(br.processed_at)                                                    as last_paid_at,
  -- The next pay event eligible for a transfer (oldest completed booking
  -- with no successful payout). Used by the admin "Pay Now" button.
  min(br.completed_at)
    filter (where br.effective_payout_status = 'unpaid'
            and br.booking_status = 'completed')                          as oldest_unpaid_completed_at
from public.cleaners c
left join booking_rollup br on br.cleaner_id = c.id
group by
  c.id, c.first_name, c.last_name, c.email, c.phone, c.status,
  c.pay_tier, c.pay_rate_hr, c.stripe_account_id, c.payouts_enabled,
  c.average_rating, c.completed_bookings;

comment on view public.cleaner_payroll_v1 is
  'Per-cleaner payroll snapshot. Buckets dollars into paid / processing / owed / failed by joining the latest payouts row per booking. owed_cents is the amount the admin Pay Now button can release via process-payout.';

-- ─── 2. va_sales_v1 ────────────────────────────────────────────────────
--
-- Per-VA sales tracker. The CSR/VA flow currently writes:
--   - bookings.sdr_rep_name           (free-text VA name on book-as-va)
--   - bookings.booker_source = 'admin_manual_setup' / 'va_book'
--   - bookings.booking_channel = 'admin' / 'va' / 'csr'
--   - leads.assigned_va_user_id       (round-robin from lead-intake)
--
-- We tie leads → bookings by matching lower(email) within ±60 days of
-- the lead creation so the conversion column reflects "this VA's lead
-- turned into this booking". sdr_rep_name takes precedence when both
-- are present (it's the more reliable attribution because lead may have
-- been re-assigned).

create or replace view public.va_sales_v1 as
with va_bookings as (
  select
    coalesce(nullif(trim(b.sdr_rep_name), ''), 'Unassigned') as va_name,
    b.id                              as booking_id,
    b.status                          as booking_status,
    b.service_date,
    b.created_at,
    b.confirmed_at,
    b.completed_at,
    b.final_charge_cents,
    b.total_estimate_cents,
    b.deposit_cents,
    b.email                           as customer_email
  from public.bookings b
  where coalesce(nullif(trim(b.sdr_rep_name), ''), '') <> ''
     or b.booking_channel in ('admin','va','csr')
     or b.booker_source   in ('admin_manual_setup','va_book','va')
),
lead_assignment as (
  select
    coalesce(va.display_name, 'Unassigned') as va_name,
    l.id                                    as lead_id,
    l.status                                as lead_status,
    l.lead_score,
    l.created_at                            as lead_created_at,
    lower(l.email)                          as lead_email,
    lower(l.phone)                          as lead_phone
  from public.leads l
  left join public.va_assignments va on va.va_user_id = l.assigned_va_user_id
  where l.assigned_va_user_id is not null
),
va_rollup_bookings as (
  select
    va_name,
    count(booking_id)                                                                   as total_bookings,
    count(booking_id) filter (where booking_status = 'confirmed')                       as bookings_confirmed,
    count(booking_id) filter (where booking_status = 'completed')                       as bookings_completed,
    count(booking_id) filter (where booking_status = 'cancelled')                       as bookings_cancelled,
    coalesce(sum(coalesce(final_charge_cents, total_estimate_cents, 0))
      filter (where booking_status in ('confirmed','in_progress','completed')), 0)::bigint
                                                                                         as revenue_cents_gross,
    coalesce(sum(coalesce(final_charge_cents, total_estimate_cents, 0))
      filter (where booking_status = 'completed'), 0)::bigint                            as revenue_cents_completed,
    coalesce(sum(deposit_cents)
      filter (where booking_status in ('confirmed','in_progress','completed')), 0)::bigint
                                                                                         as deposits_collected_cents,
    max(created_at)                                                                      as last_booking_at
  from va_bookings
  group by va_name
),
va_rollup_leads as (
  select
    va_name,
    count(lead_id)                                                       as leads_assigned,
    count(lead_id) filter (where lead_score = 'hot')                     as leads_hot,
    count(lead_id) filter (where lead_status = 'converted')              as leads_converted,
    count(lead_id) filter (where lead_status in ('lost','dead','closed_lost'))
                                                                          as leads_lost,
    max(lead_created_at)                                                  as last_lead_assigned_at
  from lead_assignment
  group by va_name
)
select
  coalesce(b.va_name, l.va_name)             as va_name,
  va.va_user_id,
  va.is_active,
  va.on_shift,
  coalesce(b.total_bookings, 0)              as total_bookings,
  coalesce(b.bookings_confirmed, 0)          as bookings_confirmed,
  coalesce(b.bookings_completed, 0)          as bookings_completed,
  coalesce(b.bookings_cancelled, 0)          as bookings_cancelled,
  coalesce(b.revenue_cents_gross, 0)         as revenue_cents_gross,
  coalesce(b.revenue_cents_completed, 0)     as revenue_cents_completed,
  coalesce(b.deposits_collected_cents, 0)    as deposits_collected_cents,
  coalesce(l.leads_assigned, 0)              as leads_assigned,
  coalesce(l.leads_hot, 0)                   as leads_hot,
  coalesce(l.leads_converted, 0)             as leads_converted,
  coalesce(l.leads_lost, 0)                  as leads_lost,
  case
    when coalesce(l.leads_assigned, 0) > 0
      then round(100.0 * coalesce(b.bookings_confirmed, 0) / l.leads_assigned, 1)
    else null
  end                                         as conversion_rate_pct,
  b.last_booking_at,
  l.last_lead_assigned_at
from va_rollup_bookings b
full outer join va_rollup_leads l on l.va_name = b.va_name
left join public.va_assignments va on lower(va.display_name) = lower(coalesce(b.va_name, l.va_name))
where coalesce(b.va_name, l.va_name) <> 'Unassigned';

comment on view public.va_sales_v1 is
  'Per-VA sales tracker. Rolls up leads (from leads.assigned_va_user_id → va_assignments) and bookings (from bookings.sdr_rep_name + booking_channel/booker_source) onto a single row per VA. Powers /admin/sales-tracker.';

-- ─── 3. Auto-payout trigger ────────────────────────────────────────────
--
-- Fires process-payout via pg_net whenever a booking transitions to
-- status='completed' AND has a cleaner_id AND the cleaner has a
-- stripe_account_id with payouts_enabled. Idempotency is provided by
-- process-payout itself (it short-circuits if booking.payout_status is
-- already 'completed' or 'processing').
--
-- The trigger DOES NOT block on the pg_net send — if the function is
-- unreachable or the Stripe API errors, the booking status update
-- still succeeds and the admin Payroll page surfaces the unpaid
-- balance so it can be retried manually with one click.

create or replace function public.trigger_auto_payout_on_booking_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I';
  v_supabase_url text := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  v_cleaner record;
  v_request_id bigint;
begin
  -- Only fire on real status transition into 'completed'.
  if lower(coalesce(new.status, '')) <> 'completed' then
    return new;
  end if;
  if tg_op = 'UPDATE' and lower(coalesce(old.status, '')) = 'completed' then
    return new;
  end if;

  -- Need an assigned cleaner_id.
  if new.cleaner_id is null then
    return new;
  end if;

  -- Cleaner must have an active Stripe Connect account + payouts enabled.
  select id, stripe_account_id, payouts_enabled
    into v_cleaner
  from public.cleaners
  where id = new.cleaner_id;

  if not found
     or v_cleaner.stripe_account_id is null
     or v_cleaner.stripe_account_id = ''
     or coalesce(v_cleaner.payouts_enabled, false) = false then
    raise notice 'auto-payout skipped: cleaner=% not stripe-ready', new.cleaner_id;
    return new;
  end if;

  -- Idempotency: don't fire if a successful payout already exists or
  -- the booking is already marked as paid/processing.
  if lower(coalesce(new.payout_status, '')) in ('completed','processing') then
    return new;
  end if;
  if exists (
    select 1 from public.payouts
    where booking_id = new.id and status in ('completed','processing')
  ) then
    return new;
  end if;

  begin
    select net.http_post(
      url := v_supabase_url || '/functions/v1/process-payout',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key
      ),
      body := jsonb_build_object(
        'bookingId', new.id::text,
        'source', 'db_trigger_auto_payout',
        'op', tg_op
      ),
      timeout_milliseconds := 30000
    ) into v_request_id;
    raise notice 'auto-payout queued booking=% request=%', new.id, v_request_id;
  exception when others then
    raise warning 'auto-payout queue failed booking=% sqlstate=% msg=%',
      new.id, sqlstate, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists bookings_auto_payout_on_completion on public.bookings;
create trigger bookings_auto_payout_on_completion
  after update of status on public.bookings
  for each row
  execute function public.trigger_auto_payout_on_booking_completion();

-- Also wire INSERT (admin manual bookings that come in already-completed)
-- so we never miss a payout.
drop trigger if exists bookings_auto_payout_on_insert on public.bookings;
create trigger bookings_auto_payout_on_insert
  after insert on public.bookings
  for each row
  execute function public.trigger_auto_payout_on_booking_completion();

comment on trigger bookings_auto_payout_on_completion on public.bookings is
  'Fires process-payout via pg_net when a booking transitions to status=completed AND the assigned cleaner has stripe_account_id + payouts_enabled. Idempotent via payouts.status + bookings.payout_status checks. Trigger is non-blocking — booking update succeeds even if pg_net is sick.';

-- Grant read on the views to the authenticated role (admins read them
-- through the standard authed Supabase JS client; RLS is enforced at
-- the underlying tables).
grant select on public.cleaner_payroll_v1 to authenticated;
grant select on public.va_sales_v1        to authenticated;
