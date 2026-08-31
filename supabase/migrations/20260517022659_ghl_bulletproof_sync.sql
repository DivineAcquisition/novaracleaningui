-- ─── Bulletproof GHL sync infrastructure ─────────────────────────────────
-- Every booking mutation must trigger a GHL refresh. The previous design
-- relied on each edge function remembering to invoke send-zapier-webhook,
-- which silently missed paths like checkout.session.completed,
-- verify-payment, submit-rating, process-payout, MemberBooking, admin
-- inserts, etc.
--
-- This migration adds the substrate:
--   1. Per-booking sync-tracking columns (ghl_synced_at + attempt count + last error).
--   2. A `ghl_sync_log` table for audit / debugging.
--   3. A trigger on `bookings` that POSTs to send-zapier-webhook on every
--      INSERT or meaningful UPDATE (filtered to avoid re-firing on the
--      sync-bookkeeping update itself).
--   4. A pg_cron job that runs reconcile-ghl every 5 minutes as a safety
--      net — re-fires sync for any booking whose ghl_synced_at is stale.

-- ─── 1) Per-booking sync tracking ────────────────────────────────────────
alter table public.bookings
  add column if not exists ghl_synced_at timestamptz,
  add column if not exists ghl_sync_attempts integer not null default 0,
  add column if not exists ghl_sync_error text;

create index if not exists idx_bookings_ghl_synced_at
  on public.bookings (ghl_synced_at nulls first);
create index if not exists idx_bookings_ghl_needs_sync
  on public.bookings (updated_at)
  where ghl_synced_at is null or ghl_synced_at < updated_at;

-- ─── 2) Sync log ─────────────────────────────────────────────────────────
create table if not exists public.ghl_sync_log (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete cascade,
  source text not null,                 -- 'pg_trigger' | 'edge_function' | 'reconcile_cron' | 'manual'
  trigger_op text,                      -- 'INSERT' | 'UPDATE' | 'MANUAL'
  http_request_id bigint,               -- pg_net request id when trigger-driven
  http_status integer,                  -- filled in by send-zapier-webhook callback (best-effort)
  succeeded boolean,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ghl_sync_log_booking on public.ghl_sync_log (booking_id, created_at desc);
create index if not exists idx_ghl_sync_log_failed on public.ghl_sync_log (created_at desc) where succeeded is false;

-- ─── 3) Trigger: every booking change → send-zapier-webhook ─────────────
create or replace function public.notify_ghl_sync()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
declare
  request_id bigint;
  fn_url constant text := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/send-zapier-webhook';
begin
  -- Skip pure sync-bookkeeping updates (we set ghl_synced_at /
  -- ghl_sync_attempts / ghl_sync_error from inside send-zapier-webhook
  -- itself — re-triggering on those would create an infinite loop).
  if tg_op = 'UPDATE' then
    if NEW.ghl_synced_at is distinct from OLD.ghl_synced_at
       and NEW.status              is not distinct from OLD.status
       and NEW.cleaner_id          is not distinct from OLD.cleaner_id
       and NEW.service_date        is not distinct from OLD.service_date
       and NEW.time_slot           is not distinct from OLD.time_slot
       and NEW.payment_intent_id   is not distinct from OLD.payment_intent_id
       and NEW.email               is not distinct from OLD.email
       and NEW.phone               is not distinct from OLD.phone
       and NEW.first_name          is not distinct from OLD.first_name
       and NEW.last_name           is not distinct from OLD.last_name
       and NEW.address             is not distinct from OLD.address
       and NEW.city                is not distinct from OLD.city
       and NEW.state               is not distinct from OLD.state
       and NEW.zip_code            is not distinct from OLD.zip_code
       and NEW.bedrooms            is not distinct from OLD.bedrooms
       and NEW.bathrooms           is not distinct from OLD.bathrooms
       and NEW.dwelling_type       is not distinct from OLD.dwelling_type
       and NEW.add_ons             is not distinct from OLD.add_ons
       and NEW.service_type        is not distinct from OLD.service_type
       and NEW.membership_plan     is not distinct from OLD.membership_plan
       and NEW.base_price_cents    is not distinct from OLD.base_price_cents
       and NEW.total_estimate_cents is not distinct from OLD.total_estimate_cents
       and NEW.final_charge_cents  is not distinct from OLD.final_charge_cents
       and NEW.deposit_cents       is not distinct from OLD.deposit_cents
       and NEW.tip_cents           is not distinct from OLD.tip_cents
       and NEW.cancel_reason       is not distinct from OLD.cancel_reason
       and NEW.cancel_fee_cents    is not distinct from OLD.cancel_fee_cents
       and NEW.reschedule_fee_cents is not distinct from OLD.reschedule_fee_cents
       and NEW.rating_submitted    is not distinct from OLD.rating_submitted
       and NEW.access_notes        is not distinct from OLD.access_notes
       and NEW.team_notes          is not distinct from OLD.team_notes
       and NEW.dispatch_notes      is not distinct from OLD.dispatch_notes
       and NEW.check_in_time       is not distinct from OLD.check_in_time
       and NEW.check_out_time      is not distinct from OLD.check_out_time
       and NEW.payment_option      is not distinct from OLD.payment_option
       and NEW.payment_method      is not distinct from OLD.payment_method
       and NEW.payout_status       is not distinct from OLD.payout_status
    then
      return NEW;
    end if;
  end if;

  -- Fire-and-forget POST. pg_net queues the request and returns an id
  -- immediately, so the transaction isn't blocked on the HTTP round
  -- trip. send-zapier-webhook is verify_jwt=false, so no auth header
  -- is required.
  begin
    select net.http_post(
      url := fn_url,
      body := jsonb_build_object('bookingId', NEW.id, 'source', 'pg_trigger', 'op', tg_op),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 30000
    ) into request_id;
  exception when others then
    -- Trigger MUST NEVER block the booking write. Swallow any
    -- pg_net error so a hiccup in the HTTP layer doesn't refuse the
    -- customer's booking. The reconcile cron will catch the drift.
    request_id := null;
  end;

  begin
    insert into public.ghl_sync_log (booking_id, source, trigger_op, http_request_id)
    values (NEW.id, 'pg_trigger', tg_op, request_id);
  exception when others then null;
  end;

  return NEW;
end;
$$;

drop trigger if exists notify_ghl_on_booking_change on public.bookings;
create trigger notify_ghl_on_booking_change
  after insert or update on public.bookings
  for each row execute function public.notify_ghl_sync();

-- ─── 4) Reconcile cron — runs every 5 minutes ───────────────────────────
-- Drops any prior schedule with this name to keep the migration
-- idempotent (re-running it won't double-schedule).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-ghl-every-5min') then
    perform cron.unschedule('reconcile-ghl-every-5min');
  end if;
end$$;

select cron.schedule(
  'reconcile-ghl-every-5min',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/reconcile-ghl',
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 60000
    );
  $cron$
);
