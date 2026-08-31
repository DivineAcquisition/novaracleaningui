-- ─── Google Calendar event sync on booking confirm ───────────────────────────
--
-- Bug: public-funnel bookings (pay → fill details) are promoted to 'confirmed'
-- by the bookings_auto_finalize_trigger, which makes finalize-booking no-op and
-- SKIP the post-confirm fan-out. The only thing that creates the Google Calendar
-- event is that fan-out (create-google-calendar-event) — and unlike the GHL
-- contact/opportunity (notify_ghl_on_booking_change trigger) and the GHL
-- appointment (reconcile-ghl-appointments cron), there was NO trigger or cron
-- backfilling Google Calendar event creation. Result: confirmed public bookings
-- never landed on Google Calendar.
--
-- Fix (mirrors the bulletproof GHL sync pattern):
--   1. A trigger that fires create-google-calendar-event the moment a booking
--      transitions INTO 'confirmed' and has no event yet.
--   2. A 10-minute reconcile cron that backfills any confirmed/in-progress
--      upcoming booking still missing an event (covers transient failures and
--      re-claims crashed 'pending:' sentinels).
--
-- create-google-calendar-event is idempotent (compare-and-swap claim on
-- google_calendar_event_id), so the trigger, the VA fan-out, and this cron can
-- all run without ever creating duplicate calendar events.

-- ─── 1) Trigger: booking → confirmed → create Google Calendar event ──────────
create or replace function public.notify_gcal_on_booking_confirm()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
declare
  request_id bigint;
  fn_url constant text := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/create-google-calendar-event';
begin
  if tg_op = 'UPDATE'
     and NEW.status = 'confirmed'
     and OLD.status is distinct from 'confirmed'
     and NEW.google_calendar_event_id is null then
    -- Fire-and-forget; never block the booking write.
    begin
      select net.http_post(
        url := fn_url,
        body := jsonb_build_object('bookingId', NEW.id),
        headers := jsonb_build_object('Content-Type', 'application/json'),
        timeout_milliseconds := 30000
      ) into request_id;
    exception when others then
      request_id := null;
    end;
  end if;
  return NEW;
end;
$$;

drop trigger if exists notify_gcal_on_booking_confirm on public.bookings;
create trigger notify_gcal_on_booking_confirm
  after update on public.bookings
  for each row execute function public.notify_gcal_on_booking_confirm();

-- ─── 2) Reconcile cron — backfill missing events every 10 minutes ────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-google-calendar-every-10min') then
    perform cron.unschedule('reconcile-google-calendar-every-10min');
  end if;
end$$;

select cron.schedule(
  'reconcile-google-calendar-every-10min',
  '*/10 * * * *',
  $cron$
    select net.http_post(
      url := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/create-google-calendar-event',
      body := jsonb_build_object('bookingId', b.id),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 30000
    )
    from public.bookings b
    where b.status in ('confirmed', 'in_progress')
      and (
        b.google_calendar_event_id is null
        or (
          b.google_calendar_event_id like 'pending:%'
          and b.google_calendar_event_id <
            'pending:' || to_char((now() at time zone 'utc') - interval '15 minutes', 'YYYY-MM-DD"T"HH24:MI:SS')
        )
      )
      and b.service_date >= (current_date - interval '1 day')
    limit 50;
  $cron$
);
