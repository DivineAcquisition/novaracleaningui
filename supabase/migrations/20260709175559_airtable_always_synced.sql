-- ─── Airtable: always mapped, always updating ────────────────────────────────
--
-- Completes live coverage so every relevant table streams to Airtable:
--   1. customers        → Clients sync on any INSERT/UPDATE (was missing)
--   2. cleaners         → Contractors sync on ANY profile change (was only
--                         firing on onboarding/agreement flips)
--   3. job_assignments  → re-sync the booking's Job row when the crew changes
--                         (names, count, per-cleaner pay all depend on it)
--   4. nightly reconcile (pg_cron) → re-posts every customer, recent bookings,
--                         payroll runs, contractors and partner data, so a
--                         missed webhook (deploy, timeout, 429) self-heals.

-- ── 1. Clients: sync on customer change ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_airtable_customer_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
declare
  sync_url text;
  sync_secret text;
  req_id bigint;
begin
  select value into sync_url    from public.app_secrets where key = 'AIRTABLE_SYNC_URL';
  select value into sync_secret from public.app_secrets where key = 'AIRTABLE_SYNC_WEBHOOK_SECRET';
  if sync_url is null or length(trim(sync_url)) = 0
     or sync_secret is null or length(trim(sync_secret)) = 0 then
    return NEW;
  end if;
  begin
    select net.http_post(
      url := trim(sync_url),
      body := jsonb_build_object('type', 'client', 'id', NEW.id),
      headers := jsonb_build_object('Content-Type','application/json','x-airtable-sync-secret', trim(sync_secret)),
      timeout_milliseconds := 30000
    ) into req_id;
  exception when others then req_id := null; end;
  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS notify_airtable_on_customer_change ON public.customers;
CREATE TRIGGER notify_airtable_on_customer_change
  AFTER INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.notify_airtable_customer_sync();

-- ── 2. Contractors: fire on ANY meaningful cleaner change ───────────────────
CREATE OR REPLACE FUNCTION public.notify_contractor_airtable_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
declare
  sync_url text;
  sync_secret text;
  req_id bigint;
begin
  -- Skip no-op timestamp touches; fire on anything that maps to Airtable.
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

  select value into sync_url    from public.app_secrets where key = 'CONTRACTOR_SYNC_URL';
  select value into sync_secret from public.app_secrets where key = 'CONTRACTOR_SYNC_SECRET';
  if sync_url is null or length(trim(sync_url)) = 0
     or sync_secret is null or length(trim(sync_secret)) = 0 then
    return NEW;
  end if;
  begin
    select net.http_post(
      url := trim(sync_url) || '?secret=' || sync_secret,
      body := jsonb_build_object('cleanerId', NEW.id),
      headers := jsonb_build_object('Content-Type','application/json'),
      timeout_milliseconds := 60000
    ) into req_id;
  exception when others then req_id := null; end;
  return NEW;
end;
$$;

DROP TRIGGER IF EXISTS notify_contractor_airtable_sync ON public.cleaners;
CREATE TRIGGER notify_contractor_airtable_sync
  AFTER INSERT OR UPDATE ON public.cleaners
  FOR EACH ROW EXECUTE FUNCTION public.notify_contractor_airtable_sync();

-- ── 3. Jobs: re-sync when the crew changes ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_airtable_assignment_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
declare
  sync_url text;
  sync_secret text;
  booking_uuid uuid;
  req_id bigint;
begin
  select value into sync_url    from public.app_secrets where key = 'AIRTABLE_SYNC_URL';
  select value into sync_secret from public.app_secrets where key = 'AIRTABLE_SYNC_WEBHOOK_SECRET';
  if sync_url is null or length(trim(sync_url)) = 0
     or sync_secret is null or length(trim(sync_secret)) = 0 then
    return coalesce(NEW, OLD);
  end if;

  select id into booking_uuid from public.bookings
   where job_id = coalesce(NEW.job_id, OLD.job_id)
   limit 1;
  if booking_uuid is null then return coalesce(NEW, OLD); end if;

  begin
    select net.http_post(
      url := trim(sync_url),
      body := jsonb_build_object('type', 'job', 'id', booking_uuid),
      headers := jsonb_build_object('Content-Type','application/json','x-airtable-sync-secret', trim(sync_secret)),
      timeout_milliseconds := 30000
    ) into req_id;
  exception when others then req_id := null; end;
  return coalesce(NEW, OLD);
end;
$$;

DROP TRIGGER IF EXISTS notify_airtable_on_assignment_change ON public.job_assignments;
CREATE TRIGGER notify_airtable_on_assignment_change
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.job_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_airtable_assignment_sync();

-- ── 4. Nightly reconcile: self-healing safety net ───────────────────────────
CREATE OR REPLACE FUNCTION public.airtable_nightly_reconcile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
declare
  sync_url text;
  sync_secret text;
  contractor_url text;
  contractor_sec text;
  partner_url text;
  partner_sec text;
  rec record;
  req_id bigint;
begin
  select value into sync_url    from public.app_secrets where key = 'AIRTABLE_SYNC_URL';
  select value into sync_secret from public.app_secrets where key = 'AIRTABLE_SYNC_WEBHOOK_SECRET';

  if sync_url is not null and sync_secret is not null then
    -- Every customer → Clients.
    for rec in select id from public.customers loop
      begin
        select net.http_post(
          url := trim(sync_url),
          body := jsonb_build_object('type','client','id', rec.id),
          headers := jsonb_build_object('Content-Type','application/json','x-airtable-sync-secret', trim(sync_secret)),
          timeout_milliseconds := 30000
        ) into req_id;
      exception when others then req_id := null; end;
    end loop;

    -- Bookings touched in the last 120 days → Jobs.
    for rec in
      select id from public.bookings
       where coalesce(updated_at, created_at) > now() - interval '120 days'
          or service_date > (current_date - 120)
    loop
      begin
        select net.http_post(
          url := trim(sync_url),
          body := jsonb_build_object('type','job','id', rec.id),
          headers := jsonb_build_object('Content-Type','application/json','x-airtable-sync-secret', trim(sync_secret)),
          timeout_milliseconds := 30000
        ) into req_id;
      exception when others then req_id := null; end;
    end loop;

    -- Payroll runs (full rebuild from custom-pay + extra-pay ledgers).
    begin
      select net.http_post(
        url := trim(sync_url),
        body := jsonb_build_object('type','payroll_runs'),
        headers := jsonb_build_object('Content-Type','application/json','x-airtable-sync-secret', trim(sync_secret)),
        timeout_milliseconds := 60000
      ) into req_id;
    exception when others then req_id := null; end;
  end if;

  -- Contractors table.
  select value into contractor_url from public.app_secrets where key = 'CONTRACTOR_SYNC_URL';
  select value into contractor_sec from public.app_secrets where key = 'CONTRACTOR_SYNC_SECRET';
  if contractor_url is not null and contractor_sec is not null then
    begin
      select net.http_post(
        url := trim(contractor_url) || '?secret=' || contractor_sec,
        body := '{}'::jsonb,
        headers := jsonb_build_object('Content-Type','application/json'),
        timeout_milliseconds := 60000
      ) into req_id;
    exception when others then req_id := null; end;
  end if;

  -- Hosts + properties.
  select value into partner_url from public.app_secrets where key = 'PARTNER_SYNC_URL';
  select value into partner_sec from public.app_secrets where key = 'PARTNER_SYNC_SECRET';
  if partner_url is not null and partner_sec is not null then
    begin
      select net.http_post(
        url := trim(partner_url) || '?secret=' || partner_sec,
        body := '{}'::jsonb,
        headers := jsonb_build_object('Content-Type','application/json'),
        timeout_milliseconds := 60000
      ) into req_id;
    exception when others then req_id := null; end;
  end if;
end;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'airtable-nightly-reconcile';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'airtable-nightly-reconcile',
  '0 7 * * *', -- 07:00 UTC = 3am ET, after the day's operations settle
  $$SELECT public.airtable_nightly_reconcile()$$
);
