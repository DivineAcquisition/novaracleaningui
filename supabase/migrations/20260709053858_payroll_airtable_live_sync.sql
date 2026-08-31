-- ─── Live Airtable payroll sync ─────────────────────────────────────────────
--
-- Payroll Runs in Airtable are built ONLY from the two real pay ledgers:
-- manual_payouts (Custom Payout) and job_extra_pay (Extra Pay). Any change to
-- either table rebuilds the runs in Airtable AND refreshes the Contractors
-- table (pay totals + run links) — so payroll stays live without cron.

CREATE OR REPLACE FUNCTION public.notify_airtable_payroll_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
declare
  sync_url        text;
  sync_secret     text;
  contractor_url  text;
  contractor_sec  text;
  req_id          bigint;
begin
  select value into sync_url    from public.app_secrets where key = 'AIRTABLE_SYNC_URL';
  select value into sync_secret from public.app_secrets where key = 'AIRTABLE_SYNC_WEBHOOK_SECRET';

  if sync_url is not null and length(trim(sync_url)) > 0
     and sync_secret is not null and length(trim(sync_secret)) > 0 then
    begin
      select net.http_post(
        url := trim(sync_url),
        body := jsonb_build_object('type', 'payroll_runs'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-airtable-sync-secret', trim(sync_secret)
        ),
        timeout_milliseconds := 60000
      ) into req_id;
    exception when others then req_id := null; end;
  end if;

  -- Refresh the Contractors table too (pay totals + payroll-run links).
  select value into contractor_url from public.app_secrets where key = 'CONTRACTOR_SYNC_URL';
  select value into contractor_sec from public.app_secrets where key = 'CONTRACTOR_SYNC_SECRET';
  if contractor_url is not null and length(trim(contractor_url)) > 0
     and contractor_sec is not null and length(trim(contractor_sec)) > 0 then
    begin
      select net.http_post(
        url := trim(contractor_url) || '?secret=' || contractor_sec,
        body := '{}'::jsonb,
        headers := jsonb_build_object('Content-Type','application/json'),
        timeout_milliseconds := 60000
      ) into req_id;
    exception when others then req_id := null; end;
  end if;

  return coalesce(NEW, OLD);
end;
$$;

DROP TRIGGER IF EXISTS notify_airtable_on_manual_payout ON public.manual_payouts;
CREATE TRIGGER notify_airtable_on_manual_payout
  AFTER INSERT OR UPDATE OF status, amount_cents, cleaner_breakdown ON public.manual_payouts
  FOR EACH ROW EXECUTE FUNCTION public.notify_airtable_payroll_sync();

DROP TRIGGER IF EXISTS notify_airtable_on_extra_pay ON public.job_extra_pay;
CREATE TRIGGER notify_airtable_on_extra_pay
  AFTER INSERT OR UPDATE OF status, total_cents ON public.job_extra_pay
  FOR EACH ROW EXECUTE FUNCTION public.notify_airtable_payroll_sync();
