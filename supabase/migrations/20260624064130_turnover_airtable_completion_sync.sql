-- On turnover completion, map the Job + cleaner pay into Airtable via a
-- DB trigger → /api/partner-admin/turnover-job-sync (applied live 2026-06-24).
insert into public.app_secrets (key, value, description) values
  ('TURNOVER_SYNC_SECRET', encode(gen_random_bytes(24),'hex'), 'Shared secret for /api/partner-admin/turnover-job-sync (DB trigger -> Airtable Job + cleaner pay on turnover completion).'),
  ('TURNOVER_SYNC_URL', 'https://try.novaracleaning.com/api/partner-admin/turnover-job-sync', 'Base URL of the turnover->Airtable job sync route.')
on conflict (key) do nothing;

create or replace function public.notify_turnover_airtable_on_complete()
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
  if tg_op = 'UPDATE' and NEW.status = 'completed' and OLD.status is distinct from 'completed' then
    select value into sync_url from public.app_secrets where key = 'TURNOVER_SYNC_URL';
    select value into sync_secret from public.app_secrets where key = 'TURNOVER_SYNC_SECRET';
    if sync_url is null or length(trim(sync_url)) = 0 or sync_secret is null or length(trim(sync_secret)) = 0 then
      return NEW;
    end if;
    begin
      select net.http_post(
        url := trim(sync_url) || '?secret=' || sync_secret,
        body := jsonb_build_object('turnoverId', NEW.id),
        headers := jsonb_build_object('Content-Type','application/json'),
        timeout_milliseconds := 30000
      ) into req_id;
    exception when others then
      req_id := null;
    end;
  end if;
  return NEW;
end;
$$;

drop trigger if exists notify_turnover_airtable_on_complete on public.turnover_requests;
create trigger notify_turnover_airtable_on_complete
  after update on public.turnover_requests
  for each row execute function public.notify_turnover_airtable_on_complete();
