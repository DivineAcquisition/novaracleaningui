-- Auto-sync contractors to the Airtable Contractors table (applied live).
-- Fires a sync when a cleaner finishes onboarding (or signs), and refreshes
-- pay every 6 hours. The /api/partner-admin/contractors-sync route accepts the
-- shared secret (in addition to admin sessions) and is idempotent.
insert into public.app_secrets (key, value, description) values
  ('CONTRACTOR_SYNC_SECRET', encode(gen_random_bytes(24),'hex'), 'Shared secret for /api/partner-admin/contractors-sync (DB trigger + cron -> Airtable Contractors table).'),
  ('CONTRACTOR_SYNC_URL', 'https://try.novaracleaning.com/api/partner-admin/contractors-sync', 'URL of the contractors -> Airtable sync route.')
on conflict (key) do nothing;

create or replace function public.notify_contractor_airtable_sync()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
declare
  sync_url text;
  sync_secret text;
  req_id bigint;
  should_fire boolean := false;
begin
  if tg_op = 'INSERT' and NEW.onboarding_complete is true then
    should_fire := true;
  elsif tg_op = 'UPDATE' and NEW.onboarding_complete is true
        and (OLD.onboarding_complete is distinct from NEW.onboarding_complete
             or OLD.ob_agreement_signed is distinct from NEW.ob_agreement_signed) then
    should_fire := true;
  end if;
  if not should_fire then return NEW; end if;

  select value into sync_url from public.app_secrets where key = 'CONTRACTOR_SYNC_URL';
  select value into sync_secret from public.app_secrets where key = 'CONTRACTOR_SYNC_SECRET';
  if sync_url is null or length(trim(sync_url)) = 0 or sync_secret is null or length(trim(sync_secret)) = 0 then
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

drop trigger if exists notify_contractor_airtable_sync on public.cleaners;
create trigger notify_contractor_airtable_sync
  after insert or update on public.cleaners
  for each row execute function public.notify_contractor_airtable_sync();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-contractors-every-6h') then
    perform cron.unschedule('reconcile-contractors-every-6h');
  end if;
end $$;

select cron.schedule(
  'reconcile-contractors-every-6h',
  '20 */6 * * *',
  $cron$
    select net.http_post(
      url := (select value from public.app_secrets where key='CONTRACTOR_SYNC_URL') || '?secret=' || (select value from public.app_secrets where key='CONTRACTOR_SYNC_SECRET'),
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type','application/json'),
      timeout_milliseconds := 120000
    );
  $cron$
);
