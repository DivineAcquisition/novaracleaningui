-- ─── Airtable LIVE SYNC pipeline: continuous, reliable, no drift ──────────────
--
-- Upgrades the existing Airtable integration from fire-and-forget pg_net posts
-- (a missed webhook = silent drift until the nightly reconcile) to a durable
-- OUTBOX + WORKER pipeline with full observability:
--
--   1. airtable_sync_queue      — durable outbox. Every trigger that used to
--      POST straight at a Next route now enqueues a coalesced work item; a
--      worker (/api/airtable/sync-worker) drains it serially through the
--      rate-limited Airtable client. Failures retry with exponential backoff;
--      Airtable being unreachable just means the queue holds the pending
--      changes until it catches up (idempotent upserts — no doubles).
--   2. airtable_sync_runs       — per-run telemetry (flow, status, duration).
--   3. airtable_sync_flow_state — one row per flow: last success, last error,
--      consecutive failures, alerting bookkeeping. Powers /admin/sync.
--   4. airtable_review_flags    — records needing ADMIN REVIEW: unmapped
--      fields, conflicts (same record edited on both sides), identity
--      ambiguities (missing/duplicate merge keys), Airtable-side deletions.
--      The sync never guesses — it flags.
--   5. airtable_webhook_state   — Airtable→app webhook registration (id, MAC
--      secret, payload cursor) so remote edits reach the workspace within
--      seconds instead of the next admin page refresh.
--
-- Existing trigger functions keep their NAMES (so already-applied triggers
-- keep working) but now enqueue instead of posting directly. All existing
-- reconcile crons are rewired through the queue so bulk re-syncs also flow
-- through the single rate-limited worker (never hammering the 5 req/s cap).
--
-- Nothing here changes WHAT is synced or WHO owns which fields — mappings,
-- merge keys and flow directions are exactly the ones the app already uses.

-- ─── 1. Outbox queue ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.airtable_sync_queue (
  id bigserial PRIMARY KEY,
  flow text NOT NULL,                       -- client | job | payroll_runs | qc_issue | qc_issues_all | partner | contractors | turnover | vas | commercial
  entity_id text,                           -- source row id when the flow is per-record
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,                 -- flow:entity — coalesces bursts while pending
  source text NOT NULL DEFAULT 'live',      -- live | reconcile | manual
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','dead')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- One PENDING item per (flow, entity): a burst of changes to the same record
-- coalesces into a single re-sync (the sync reads current state, so the last
-- write always wins — never a stale intermediate).
CREATE UNIQUE INDEX IF NOT EXISTS airtable_sync_queue_pending_key
  ON public.airtable_sync_queue (dedupe_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS airtable_sync_queue_due_idx
  ON public.airtable_sync_queue (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS airtable_sync_queue_flow_idx
  ON public.airtable_sync_queue (flow, status);

ALTER TABLE public.airtable_sync_queue ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='airtable_sync_queue' AND policyname='airtable_sync_queue_admin_read') THEN
    CREATE POLICY airtable_sync_queue_admin_read ON public.airtable_sync_queue
      FOR SELECT TO authenticated USING (public.is_admin_or_va(auth.uid()));
  END IF;
END $$;

-- Worker lease: at most one drainer at a time so concurrent lambdas can't
-- stack their per-process rate queues past Airtable's 5 req/s/base ceiling.
CREATE TABLE IF NOT EXISTS public.airtable_worker_lease (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  worker_token uuid,
  locked_until timestamptz
);
INSERT INTO public.airtable_worker_lease (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.airtable_worker_lease ENABLE ROW LEVEL SECURITY;

-- ─── 2. Run telemetry ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.airtable_sync_runs (
  id bigserial PRIMARY KEY,
  flow text NOT NULL,
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
  trigger_source text NOT NULL DEFAULT 'live',   -- live | reconcile | manual | external | webhook | poll
  status text NOT NULL CHECK (status IN ('success','error','skipped')),
  records_synced int,
  error text,
  detail jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NOT NULL DEFAULT now(),
  duration_ms int
);
CREATE INDEX IF NOT EXISTS airtable_sync_runs_flow_idx ON public.airtable_sync_runs (flow, started_at DESC);
CREATE INDEX IF NOT EXISTS airtable_sync_runs_time_idx ON public.airtable_sync_runs (started_at DESC);

ALTER TABLE public.airtable_sync_runs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='airtable_sync_runs' AND policyname='airtable_sync_runs_admin_read') THEN
    CREATE POLICY airtable_sync_runs_admin_read ON public.airtable_sync_runs
      FOR SELECT TO authenticated USING (public.is_admin_or_va(auth.uid()));
  END IF;
END $$;

-- ─── 3. Per-flow health state ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.airtable_sync_flow_state (
  flow text PRIMARY KEY,
  display_name text NOT NULL,
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  consecutive_failures int NOT NULL DEFAULT 0,
  alerted_at timestamptz,
  -- inbound bookkeeping (only used on the 'inbound' row)
  last_checked_at timestamptz,
  last_remote_change_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.airtable_sync_flow_state ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='airtable_sync_flow_state' AND policyname='airtable_sync_flow_state_admin_read') THEN
    CREATE POLICY airtable_sync_flow_state_admin_read ON public.airtable_sync_flow_state
      FOR SELECT TO authenticated USING (public.is_admin_or_va(auth.uid()));
  END IF;
END $$;

INSERT INTO public.airtable_sync_flow_state (flow, display_name, direction) VALUES
  ('client',       'Clients (customers → Airtable)',            'outbound'),
  ('job',          'Jobs (bookings → Airtable)',                'outbound'),
  ('payroll_runs', 'Payroll Runs',                              'outbound'),
  ('qc_issue',     'QC Issues',                                 'outbound'),
  ('partner',      'STR Hosts & Properties',                    'outbound'),
  ('turnover',     'STR Turnovers → Jobs',                      'outbound'),
  ('contractors',  'Contractors',                               'outbound'),
  ('vas',          'VAs',                                       'outbound'),
  ('commercial',   'Commercial Accounts & Sites',               'outbound'),
  ('inbound',      'Airtable → Workspace (remote changes)',     'inbound')
ON CONFLICT (flow) DO NOTHING;

-- ─── 4. Review flags (never guess — flag for admin) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.airtable_review_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow text NOT NULL,
  reason text NOT NULL
    CHECK (reason IN ('unmapped_field','conflict','identity','unknown_option','deletion','error')),
  record_ref text,                          -- merge key / record id involved
  airtable_table text,
  field_ref text,
  message text NOT NULL,
  detail jsonb,
  dedupe_key text NOT NULL UNIQUE,          -- repeated occurrences bump, not duplicate
  seen_count int NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_by text,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS airtable_review_flags_open_idx
  ON public.airtable_review_flags (status, last_seen_at DESC);

ALTER TABLE public.airtable_review_flags ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='airtable_review_flags' AND policyname='airtable_review_flags_admin_read') THEN
    CREATE POLICY airtable_review_flags_admin_read ON public.airtable_review_flags
      FOR SELECT TO authenticated USING (public.is_admin_or_va(auth.uid()));
  END IF;
END $$;

-- ─── 5. Airtable webhook registration state (inbound) ───────────────────────
-- Holds the MAC secret — service-role only (RLS on, no policies).

CREATE TABLE IF NOT EXISTS public.airtable_webhook_state (
  id text PRIMARY KEY,                      -- Airtable webhook id (ach...)
  base_id text NOT NULL,
  mac_secret_b64 text NOT NULL,
  cursor_position bigint NOT NULL DEFAULT 1,
  notification_url text,
  expiration_time timestamptz,
  last_ping_at timestamptz,
  last_payload_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.airtable_webhook_state ENABLE ROW LEVEL SECURITY;

-- ─── 6. Worker URL + nudge helper ────────────────────────────────────────────

INSERT INTO public.app_secrets (key, value, description)
SELECT 'AIRTABLE_WORKER_URL',
       replace(value, '/api/airtable/sync', '/api/airtable/sync-worker'),
       'URL of the Airtable sync worker route (queue drainer). Auth: AIRTABLE_SYNC_WEBHOOK_SECRET.'
FROM public.app_secrets WHERE key = 'AIRTABLE_SYNC_URL'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_secrets (key, value, description) VALUES
  ('AIRTABLE_WORKER_URL', 'https://try.novaracleaning.com/api/airtable/sync-worker',
   'URL of the Airtable sync worker route (queue drainer). Auth: AIRTABLE_SYNC_WEBHOOK_SECRET.')
ON CONFLICT (key) DO NOTHING;

-- Fire-and-forget POST at the worker. Never blocks or fails the caller.
CREATE OR REPLACE FUNCTION public.airtable_nudge_worker(p_task text DEFAULT 'drain')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, net
AS $$
declare
  worker_url text;
  sync_secret text;
  req_id bigint;
begin
  select value into worker_url  from public.app_secrets where key = 'AIRTABLE_WORKER_URL';
  select value into sync_secret from public.app_secrets where key = 'AIRTABLE_SYNC_WEBHOOK_SECRET';
  if worker_url is null or length(trim(worker_url)) = 0
     or sync_secret is null or length(trim(sync_secret)) = 0 then
    return;
  end if;
  begin
    select net.http_post(
      url := trim(worker_url),
      body := jsonb_build_object('task', coalesce(p_task, 'drain')),
      headers := jsonb_build_object('Content-Type','application/json','x-airtable-sync-secret', trim(sync_secret)),
      timeout_milliseconds := 15000
    ) into req_id;
  exception when others then req_id := null; end;
end;
$$;

-- ─── 7. Enqueue / claim / complete ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.airtable_enqueue(
  p_flow text,
  p_entity text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_nudge boolean DEFAULT true,
  p_source text DEFAULT 'live'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
declare
  v_key text := p_flow || ':' || coalesce(p_entity, '*');
begin
  insert into public.airtable_sync_queue as q (flow, entity_id, payload, dedupe_key, source)
  values (p_flow, p_entity, coalesce(p_payload, '{}'::jsonb), v_key, coalesce(p_source, 'live'))
  on conflict (dedupe_key) where status = 'pending'
  do update set
    payload = excluded.payload,
    next_attempt_at = least(q.next_attempt_at, now()),
    updated_at = now();

  if p_nudge then
    perform public.airtable_nudge_worker('drain');
  end if;
end;
$$;

-- Atomically claim due items. The single-drainer lease keeps total request
-- concurrency at 1 so the app-side rate queue is the true global limiter.
CREATE OR REPLACE FUNCTION public.airtable_claim_queue(
  p_worker uuid,
  p_batch int DEFAULT 5,
  p_lease_seconds int DEFAULT 120
)
RETURNS SETOF public.airtable_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
begin
  update public.airtable_worker_lease
     set worker_token = p_worker,
         locked_until = now() + make_interval(secs => p_lease_seconds)
   where id = 1
     and (worker_token = p_worker or locked_until is null or locked_until < now());
  if not found then
    return; -- another worker holds the lease
  end if;

  return query
  with due as (
    select id from public.airtable_sync_queue
     where status = 'pending' and next_attempt_at <= now()
     order by next_attempt_at asc, id asc
     limit greatest(1, p_batch)
     for update skip locked
  )
  update public.airtable_sync_queue q
     set status = 'processing', attempts = q.attempts + 1, updated_at = now()
    from due
   where q.id = due.id
  returning q.*;
end;
$$;

CREATE OR REPLACE FUNCTION public.airtable_release_worker_lease(p_worker uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  update public.airtable_worker_lease
     set locked_until = null, worker_token = null
   where id = 1 and worker_token = p_worker;
$$;

-- Mark an item done / retry with exponential backoff / dead after 8 attempts.
CREATE OR REPLACE FUNCTION public.airtable_complete_queue(
  p_id bigint,
  p_ok boolean,
  p_error text DEFAULT NULL,
  p_permanent boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
declare
  v_attempts int;
  v_backoff_secs numeric;
  v_key text;
  v_superseded boolean;
begin
  if p_ok then
    update public.airtable_sync_queue
       set status = 'done', processed_at = now(), updated_at = now(), last_error = null
     where id = p_id;
    return;
  end if;

  select attempts, dedupe_key into v_attempts, v_key
    from public.airtable_sync_queue where id = p_id;
  if v_attempts is null then return; end if;

  -- A newer pending item for the same entity may have arrived while this one
  -- was processing (that's by design — change-during-sync is never dropped).
  -- The newer item will re-sync the entity, so this one is superseded rather
  -- than retried (also avoids colliding with the one-pending-per-key index).
  select exists (
    select 1 from public.airtable_sync_queue
     where dedupe_key = v_key and status = 'pending' and id <> p_id
  ) into v_superseded;

  if p_permanent or v_attempts >= 8 then
    update public.airtable_sync_queue
       set status = 'dead', last_error = left(coalesce(p_error,'unknown'), 2000), updated_at = now()
     where id = p_id;
  elsif v_superseded then
    update public.airtable_sync_queue
       set status = 'done', processed_at = now(), updated_at = now(),
           last_error = left('superseded by a newer change — ' || coalesce(p_error,'unknown'), 2000)
     where id = p_id;
  else
    -- 60s, 120s, 240s, 480s, 960s, capped at 30 min (+ jitter)
    v_backoff_secs := least(1800, 30 * power(2, least(v_attempts, 6))) + floor(random() * 20);
    update public.airtable_sync_queue
       set status = 'pending',
           last_error = left(coalesce(p_error,'unknown'), 2000),
           next_attempt_at = now() + make_interval(secs => v_backoff_secs),
           updated_at = now()
     where id = p_id;
  end if;
end;
$$;

-- Aggregate queue stats for the health view (one round-trip).
CREATE OR REPLACE FUNCTION public.airtable_queue_stats()
RETURNS TABLE (flow text, status text, n bigint, oldest timestamptz)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  select q.flow, q.status, count(*)::bigint,
         min(q.created_at)
    from public.airtable_sync_queue q
   where q.status in ('pending','processing','dead')
      or (q.status = 'done' and q.processed_at > now() - interval '24 hours')
   group by q.flow, q.status;
$$;

-- Lock the RPCs down to the service role (triggers run as owner regardless).
REVOKE EXECUTE ON FUNCTION public.airtable_enqueue(text, text, jsonb, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.airtable_claim_queue(uuid, int, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.airtable_release_worker_lease(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.airtable_complete_queue(bigint, boolean, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.airtable_queue_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.airtable_nudge_worker(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.airtable_enqueue(text, text, jsonb, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.airtable_claim_queue(uuid, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.airtable_release_worker_lease(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.airtable_complete_queue(bigint, boolean, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.airtable_queue_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.airtable_nudge_worker(text) TO service_role;

-- ─── 8. Rewire the existing trigger functions through the queue ─────────────
-- Same function NAMES as the live triggers reference; same change-detection
-- gates; only the delivery changes (durable enqueue instead of one-shot POST).

-- bookings → Jobs
CREATE OR REPLACE FUNCTION public.notify_airtable_revops_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF tg_op = 'UPDATE' THEN
    IF NEW.status               IS NOT DISTINCT FROM OLD.status
       AND NEW.service_date         IS NOT DISTINCT FROM OLD.service_date
       AND NEW.time_slot            IS NOT DISTINCT FROM OLD.time_slot
       AND NEW.service_type         IS NOT DISTINCT FROM OLD.service_type
       AND NEW.email                IS NOT DISTINCT FROM OLD.email
       AND NEW.phone                IS NOT DISTINCT FROM OLD.phone
       AND NEW.first_name           IS NOT DISTINCT FROM OLD.first_name
       AND NEW.last_name            IS NOT DISTINCT FROM OLD.last_name
       AND NEW.total_estimate_cents IS NOT DISTINCT FROM OLD.total_estimate_cents
       AND NEW.final_charge_cents   IS NOT DISTINCT FROM OLD.final_charge_cents
       AND NEW.cleaner_payout_cents IS NOT DISTINCT FROM OLD.cleaner_payout_cents
       AND NEW.payout_status        IS NOT DISTINCT FROM OLD.payout_status
       AND NEW.num_cleaners_assigned IS NOT DISTINCT FROM OLD.num_cleaners_assigned
       AND NEW.membership_plan      IS NOT DISTINCT FROM OLD.membership_plan
       AND NEW.completed_at         IS NOT DISTINCT FROM OLD.completed_at
       AND NEW.before_photos        IS NOT DISTINCT FROM OLD.before_photos
       AND NEW.after_photos         IS NOT DISTINCT FROM OLD.after_photos
    THEN
      RETURN NEW;
    END IF;
  END IF;

  BEGIN
    PERFORM public.airtable_enqueue('job', NEW.id::text, jsonb_build_object('bookingId', NEW.id));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END;
$$;

-- customers → Clients
CREATE OR REPLACE FUNCTION public.notify_airtable_customer_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
begin
  begin
    perform public.airtable_enqueue('client', NEW.id::text, jsonb_build_object('id', NEW.id));
  exception when others then null; end;
  return NEW;
end;
$$;

-- job_assignments → re-sync the booking's Job row
CREATE OR REPLACE FUNCTION public.notify_airtable_assignment_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
declare
  booking_uuid uuid;
begin
  select id into booking_uuid from public.bookings
   where job_id = coalesce(NEW.job_id, OLD.job_id)
   limit 1;
  if booking_uuid is null then return coalesce(NEW, OLD); end if;
  begin
    perform public.airtable_enqueue('job', booking_uuid::text, jsonb_build_object('bookingId', booking_uuid));
  exception when others then null; end;
  return coalesce(NEW, OLD);
end;
$$;

-- manual_payouts / job_extra_pay → Payroll Runs rebuild + Contractors refresh
CREATE OR REPLACE FUNCTION public.notify_airtable_payroll_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
begin
  begin
    perform public.airtable_enqueue('payroll_runs', null, '{}'::jsonb, false);
    perform public.airtable_enqueue('contractors', null, '{}'::jsonb, true);
  exception when others then null; end;
  return coalesce(NEW, OLD);
end;
$$;

-- qc_issues → QC Issues backlog
CREATE OR REPLACE FUNCTION public.notify_airtable_on_qc_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.airtable_enqueue('qc_issue', NEW.id::text, jsonb_build_object('id', NEW.id));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END;
$$;

-- job_documentation → re-sync the booking's Job row (Drive link / documented)
CREATE OR REPLACE FUNCTION public.notify_airtable_on_job_documentation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF tg_op = 'UPDATE'
     AND NEW.documented IS NOT DISTINCT FROM OLD.documented
     AND NEW.mirror_status IS NOT DISTINCT FROM OLD.mirror_status
     AND NEW.drive_folder_url IS NOT DISTINCT FROM OLD.drive_folder_url THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.airtable_enqueue('job', NEW.booking_id::text, jsonb_build_object('bookingId', NEW.booking_id));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END;
$$;

-- hosts / properties → STR identity sync (Airtable keeps owning rates/status)
CREATE OR REPLACE FUNCTION public.notify_partner_airtable_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
begin
  begin
    perform public.airtable_enqueue('partner', null, '{}'::jsonb);
  exception when others then null; end;
  return NEW;
end;
$$;

-- cleaners → Contractors (keep the broad meaningful-change gate)
CREATE OR REPLACE FUNCTION public.notify_contractor_airtable_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
begin
  if tg_op = 'UPDATE'
     and NEW.first_name          is not distinct from OLD.first_name
     and NEW.last_name           is not distinct from OLD.last_name
     and NEW.email               is not distinct from OLD.email
     and NEW.phone               is not distinct from OLD.phone
     and NEW.status              is not distinct from OLD.status
     and NEW.pay_tier            is not distinct from OLD.pay_tier
     and NEW.pay_percentage      is not distinct from OLD.pay_percentage
     and NEW.home_address        is not distinct from OLD.home_address
     and NEW.home_city           is not distinct from OLD.home_city
     and NEW.state               is not distinct from OLD.state
     and NEW.home_zip            is not distinct from OLD.home_zip
     and NEW.skillset            is not distinct from OLD.skillset
     and NEW.stripe_account_id   is not distinct from OLD.stripe_account_id
     and NEW.payouts_enabled     is not distinct from OLD.payouts_enabled
     and NEW.onboarding_complete is not distinct from OLD.onboarding_complete
     and NEW.ob_agreement_signed is not distinct from OLD.ob_agreement_signed
  then
    return NEW;
  end if;
  begin
    perform public.airtable_enqueue('contractors', null, '{}'::jsonb);
  exception when others then null; end;
  return NEW;
end;
$$;

-- turnover_requests → Job on completion (same status-transition gate)
CREATE OR REPLACE FUNCTION public.notify_turnover_airtable_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
begin
  if tg_op = 'UPDATE' and NEW.status = 'completed' and OLD.status is distinct from 'completed' then
    begin
      perform public.airtable_enqueue('turnover', NEW.id::text, jsonb_build_object('turnoverId', NEW.id));
    exception when others then null; end;
  end if;
  return NEW;
end;
$$;

-- ─── 9. NEW live triggers for flows that only had manual/cron sync ──────────

-- va_onboarding → VAs table (was a manual admin button only)
CREATE OR REPLACE FUNCTION public.notify_va_airtable_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
begin
  begin
    perform public.airtable_enqueue('vas', null, '{}'::jsonb);
  exception when others then null; end;
  return coalesce(NEW, OLD);
end;
$$;

DO $$
BEGIN
  IF to_regclass('public.va_onboarding') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS notify_va_airtable_on_change ON public.va_onboarding;
    CREATE TRIGGER notify_va_airtable_on_change
      AFTER INSERT OR UPDATE ON public.va_onboarding
      FOR EACH ROW EXECUTE FUNCTION public.notify_va_airtable_sync();
  END IF;
END $$;

-- business_accounts / business_sites → Commercial Accounts & Sites
-- (was intake-time + on-demand only; edits after intake never reached Airtable)
CREATE OR REPLACE FUNCTION public.notify_commercial_airtable_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
begin
  begin
    perform public.airtable_enqueue('commercial', null, '{}'::jsonb);
  exception when others then null; end;
  return coalesce(NEW, OLD);
end;
$$;

DO $$
BEGIN
  IF to_regclass('public.business_accounts') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS notify_commercial_airtable_on_account ON public.business_accounts;
    CREATE TRIGGER notify_commercial_airtable_on_account
      AFTER INSERT OR UPDATE ON public.business_accounts
      FOR EACH ROW EXECUTE FUNCTION public.notify_commercial_airtable_sync();
  END IF;
  IF to_regclass('public.business_sites') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS notify_commercial_airtable_on_site ON public.business_sites;
    CREATE TRIGGER notify_commercial_airtable_on_site
      AFTER INSERT OR UPDATE ON public.business_sites
      FOR EACH ROW EXECUTE FUNCTION public.notify_commercial_airtable_sync();
  END IF;
END $$;

-- ─── 10. Reconciles now flow through the queue ───────────────────────────────

-- Enumerate everything into the queue (coalesced), then nudge once. The worker
-- drains serially under the rate limit — the old version fired one lambda per
-- record which could stampede past 5 req/s.
CREATE OR REPLACE FUNCTION public.airtable_enqueue_reconcile()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
declare
  rec record;
  n int := 0;
begin
  for rec in select id from public.customers loop
    perform public.airtable_enqueue('client', rec.id::text, jsonb_build_object('id', rec.id), false, 'reconcile');
    n := n + 1;
  end loop;

  for rec in
    select id from public.bookings
     where coalesce(updated_at, created_at) > now() - interval '120 days'
        or service_date > (current_date - 120)
  loop
    perform public.airtable_enqueue('job', rec.id::text, jsonb_build_object('bookingId', rec.id), false, 'reconcile');
    n := n + 1;
  end loop;

  perform public.airtable_enqueue('payroll_runs',  null, '{}'::jsonb, false, 'reconcile');
  perform public.airtable_enqueue('contractors',   null, '{}'::jsonb, false, 'reconcile');
  perform public.airtable_enqueue('partner',       null, '{}'::jsonb, false, 'reconcile');
  perform public.airtable_enqueue('vas',           null, '{}'::jsonb, false, 'reconcile');
  perform public.airtable_enqueue('commercial',    null, '{}'::jsonb, false, 'reconcile');
  perform public.airtable_enqueue('qc_issues_all', null, '{}'::jsonb, false, 'reconcile');

  perform public.airtable_nudge_worker('drain');
  return n + 6;
end;
$$;
REVOKE EXECUTE ON FUNCTION public.airtable_enqueue_reconcile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.airtable_enqueue_reconcile() TO service_role;

-- Keep the existing cron names; their bodies now enqueue.
CREATE OR REPLACE FUNCTION public.airtable_nightly_reconcile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
begin
  perform public.airtable_enqueue_reconcile();
end;
$$;

CREATE OR REPLACE FUNCTION public.airtable_qc_reconcile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
begin
  perform public.airtable_enqueue('qc_issues_all', null, '{}'::jsonb, true, 'reconcile');
end;
$$;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-partners-every-6h') THEN
    PERFORM cron.unschedule('reconcile-partners-every-6h');
  END IF;
  PERFORM cron.schedule(
    'reconcile-partners-every-6h',
    '40 */6 * * *',
    $$SELECT public.airtable_enqueue('partner', NULL, '{}'::jsonb, true, 'reconcile')$$
  );

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-contractors-every-6h') THEN
    PERFORM cron.unschedule('reconcile-contractors-every-6h');
  END IF;
  PERFORM cron.schedule(
    'reconcile-contractors-every-6h',
    '20 */6 * * *',
    $$SELECT public.airtable_enqueue('contractors', NULL, '{}'::jsonb, true, 'reconcile')$$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping reconcile cron rewiring: %', SQLERRM;
END $do$;

-- ─── 11. Drain / inbound / watchdog crons ────────────────────────────────────

DO $do$
BEGIN
  -- Catch-up drain: retries + anything a nudge missed. No-ops when idle.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'airtable-queue-drain') THEN
    PERFORM cron.unschedule('airtable-queue-drain');
  END IF;
  PERFORM cron.schedule(
    'airtable-queue-drain',
    '* * * * *',
    $$SELECT public.airtable_nudge_worker('drain')
       WHERE EXISTS (SELECT 1 FROM public.airtable_sync_queue
                      WHERE status = 'pending' AND next_attempt_at <= now())$$
  );

  -- Inbound: fetch Airtable webhook payloads (also extends webhook life) or
  -- fall back to change-detection polling when no webhook is registered.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'airtable-inbound-poll') THEN
    PERFORM cron.unschedule('airtable-inbound-poll');
  END IF;
  PERFORM cron.schedule(
    'airtable-inbound-poll',
    '*/5 * * * *',
    $$SELECT public.airtable_nudge_worker('poll-inbound')$$
  );

  -- Ensure the Airtable→app webhook exists / is refreshed (7-day expiry).
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'airtable-webhook-ensure') THEN
    PERFORM cron.unschedule('airtable-webhook-ensure');
  END IF;
  PERFORM cron.schedule(
    'airtable-webhook-ensure',
    '10 6 * * *',
    $$SELECT public.airtable_nudge_worker('ensure-webhook')$$
  );

  -- Watchdog: DB-side alerting so a broken worker can't fail silently.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'airtable-sync-watchdog') THEN
    PERFORM cron.unschedule('airtable-sync-watchdog');
  END IF;
  PERFORM cron.schedule(
    'airtable-sync-watchdog',
    '*/30 * * * *',
    $$SELECT public.airtable_sync_watchdog()$$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping airtable sync cron scheduling: %', SQLERRM;
END $do$;

-- ─── 12. Watchdog: alert when syncing breaks (even if the worker is down) ───

CREATE OR REPLACE FUNCTION public.airtable_sync_watchdog()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
declare
  v_overdue int;
  v_dead int;
  v_recent timestamptz;
  rec record;
begin
  -- Reclaim items stranded in 'processing' by a dead worker (idempotent —
  -- re-running the sync converges to the same state). If a newer pending item
  -- for the same entity already exists it supersedes the stranded one.
  update public.airtable_sync_queue q
     set status = 'done', processed_at = now(), updated_at = now(),
         last_error = 'superseded — reclaimed after worker stall'
   where q.status = 'processing' and q.updated_at < now() - interval '10 minutes'
     and exists (
       select 1 from public.airtable_sync_queue p
        where p.dedupe_key = q.dedupe_key and p.status = 'pending' and p.id <> q.id
     );

  update public.airtable_sync_queue
     set status = 'pending', next_attempt_at = now(), updated_at = now()
   where status = 'processing' and updated_at < now() - interval '10 minutes';

  select count(*) into v_overdue from public.airtable_sync_queue
   where status = 'pending' and next_attempt_at < now() - interval '45 minutes';
  select count(*) into v_dead from public.airtable_sync_queue
   where status = 'dead' and updated_at > now() - interval '24 hours';

  if v_overdue > 0 or v_dead > 0 then
    select max(occurred_at) into v_recent from public.events
     where event_type = 'airtable.sync.failing' and occurred_at > now() - interval '6 hours';
    if v_recent is null then
      insert into public.events (event_type, source, summary, data)
      values (
        'airtable.sync.failing',
        'airtable-sync-watchdog',
        format('Airtable sync backlog: %s change(s) stuck >45 min, %s given up in the last 24h. Review at /admin/sync.', v_overdue, v_dead),
        jsonb_build_object('overdue', v_overdue, 'dead', v_dead)
      );
    end if;
  end if;

  -- Flows failing repeatedly (covers the case where the worker itself is the
  -- thing that's broken and app-side alerting never runs).
  for rec in
    select flow, display_name, consecutive_failures, last_error
      from public.airtable_sync_flow_state
     where consecutive_failures >= 3
       and (alerted_at is null or alerted_at < now() - interval '6 hours')
  loop
    insert into public.events (event_type, source, summary, data)
    values (
      'airtable.sync.failing',
      'airtable-sync-watchdog',
      format('Airtable sync flow "%s" has failed %s times in a row: %s',
             rec.display_name, rec.consecutive_failures, left(coalesce(rec.last_error, 'unknown error'), 300)),
      jsonb_build_object('flow', rec.flow, 'consecutiveFailures', rec.consecutive_failures)
    );
    update public.airtable_sync_flow_state set alerted_at = now(), updated_at = now()
     where flow = rec.flow;
  end loop;
exception when others then
  null; -- the watchdog must never take anything else down
end;
$$;
REVOKE EXECUTE ON FUNCTION public.airtable_sync_watchdog() FROM PUBLIC, anon, authenticated;

-- ─── 13. Route sync alerts to the existing Discord notification channel ─────

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('airtable.sync.failing',   'DISCORD_WEBHOOK_FLAG', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('airtable.sync.recovered', 'DISCORD_WEBHOOK_FLAG', ARRAY[]::text[])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;
