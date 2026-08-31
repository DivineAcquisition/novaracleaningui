-- ─── Partner recurring-turnover weekly cron ──────────────────────────────
--
-- Schedules the partner-recurring-generate edge function:
--   * Wednesday 14:00 UTC — heads-up notice (N cleans, $X tomorrow)
--   * Thursday  14:00 UTC — generate next week's batch + off-session charge
--
-- pg_cron calls the function via pg_net, authenticating with a CRON_SECRET
-- (so the service-role key is never embedded in the job). The secret is read
-- from app_secrets at call time.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Seed a CRON_SECRET if one isn't already present.
insert into public.app_secrets (key, value)
values ('CRON_SECRET', encode(gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

do $$
begin
  perform cron.unschedule('partner_recurring_headsup') where exists (select 1 from cron.job where jobname = 'partner_recurring_headsup');
  perform cron.unschedule('partner_recurring_generate') where exists (select 1 from cron.job where jobname = 'partner_recurring_generate');
end $$;

select cron.schedule('partner_recurring_headsup', '0 14 * * 3', $$
  select net.http_post(
    url := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/partner-recurring-generate',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='CRON_SECRET')),
    body := '{"mode":"heads_up"}'::jsonb
  );
$$);

select cron.schedule('partner_recurring_generate', '0 14 * * 4', $$
  select net.http_post(
    url := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/partner-recurring-generate',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_secrets where key='CRON_SECRET')),
    body := '{"mode":"generate"}'::jsonb
  );
$$);
