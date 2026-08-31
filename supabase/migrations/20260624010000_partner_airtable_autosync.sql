-- Auto-sync STR hosts + properties to the Airtable Client & Revenue Ops base
-- whenever they change in Supabase (applied live), so the Host Accounts view
-- stays current. The /api/partner-admin/sync route accepts the shared secret
-- (in addition to admin sessions) and is idempotent (identity-only upserts).
insert into public.app_secrets (key, value, description) values
  ('PARTNER_SYNC_SECRET', encode(gen_random_bytes(24),'hex'), 'Shared secret for /api/partner-admin/sync (DB trigger + cron -> Airtable host/property identity sync).'),
  ('PARTNER_SYNC_URL', 'https://try.novaracleaning.com/api/partner-admin/sync', 'URL of the partner host/property -> Airtable sync route.')
on conflict (key) do nothing;

create or replace function public.notify_partner_airtable_sync()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
declare
  sync_url text;
  sync_secret text;
  req_id bigint;
begin
  select value into sync_url from public.app_secrets where key = 'PARTNER_SYNC_URL';
  select value into sync_secret from public.app_secrets where key = 'PARTNER_SYNC_SECRET';
  if sync_url is null or length(trim(sync_url)) = 0 or sync_secret is null or length(trim(sync_secret)) = 0 then
    return NEW;
  end if;
  begin
    select net.http_post(
      url := trim(sync_url) || '?secret=' || sync_secret,
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type','application/json'),
      timeout_milliseconds := 60000
    ) into req_id;
  exception when others then req_id := null; end;
  return NEW;
end;
$$;

drop trigger if exists notify_partner_airtable_sync_hosts on public.hosts;
create trigger notify_partner_airtable_sync_hosts
  after insert or update on public.hosts
  for each row execute function public.notify_partner_airtable_sync();

drop trigger if exists notify_partner_airtable_sync_props on public.properties;
create trigger notify_partner_airtable_sync_props
  after insert or update on public.properties
  for each row execute function public.notify_partner_airtable_sync();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-partners-every-6h') then
    perform cron.unschedule('reconcile-partners-every-6h');
  end if;
end $$;

select cron.schedule(
  'reconcile-partners-every-6h',
  '40 */6 * * *',
  $cron$
    select net.http_post(
      url := (select value from public.app_secrets where key='PARTNER_SYNC_URL') || '?secret=' || (select value from public.app_secrets where key='PARTNER_SYNC_SECRET'),
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type','application/json'),
      timeout_milliseconds := 120000
    );
  $cron$
);
