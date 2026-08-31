-- ─── Nightly reconcile: include the QC Issues backlog ────────────────────────
-- Extends airtable_nightly_reconcile() so a missed qc_issues webhook (deploy
-- window, timeout, 429) self-heals: one qc_issues_all pass per night re-upserts
-- every issue with its documentation evidence mapped in.

CREATE OR REPLACE FUNCTION public.airtable_qc_reconcile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
declare
  sync_url text;
  sync_secret text;
  req_id bigint;
begin
  select value into sync_url    from public.app_secrets where key = 'AIRTABLE_SYNC_URL';
  select value into sync_secret from public.app_secrets where key = 'AIRTABLE_SYNC_WEBHOOK_SECRET';
  if sync_url is null or length(trim(sync_url)) = 0
     or sync_secret is null or length(trim(sync_secret)) = 0 then
    return;
  end if;
  begin
    select net.http_post(
      url := trim(sync_url),
      body := jsonb_build_object('type','qc_issues_all'),
      headers := jsonb_build_object('Content-Type','application/json','x-airtable-sync-secret', trim(sync_secret)),
      timeout_milliseconds := 120000
    ) into req_id;
  exception when others then req_id := null; end;
end;
$fn$;

-- Schedule right after the main nightly reconcile (07:15 UTC).
DO $do$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'airtable-qc-reconcile';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule('airtable-qc-reconcile'); END IF;
  PERFORM cron.schedule(
    'airtable-qc-reconcile',
    '15 7 * * *',
    'SELECT public.airtable_qc_reconcile()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping airtable-qc-reconcile scheduling: %', SQLERRM;
END $do$;
