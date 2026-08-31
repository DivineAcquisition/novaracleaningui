-- Reduce pg_cron request volume.
--
-- Why: the project crossed ~15M Supabase requests/month. The driver is not
-- customer traffic — it's oversampled sweep/reconcile crons. Each tick is an
-- edge-function invocation that then makes many PostgREST calls of its own, so
-- an every-minute job that usually finds nothing still costs real volume.
--
-- What this does NOT touch, because their timing is load-bearing:
--   send-day-of-reminders (*/15)      — [start-40, start-5] band needs a tick
--                                       inside a 35-minute window
--   send-booking-reminders (*/30)     — 8–12 min "10 minute" band
--   same-day-sourcing-deadline (*/5)  — same-day cancel/refund deadline
--   prepare-completion-hold (hourly)  — pre-auth holds at S-5
--   send-appointment-reminders        — hourly daytime band
--   airtable-queue-drain (* * * * *)  — guarded by EXISTS(pending), so an idle
--                                       minute issues no HTTP call at all
--
-- Every schedule below was checked against the function's own tolerance window
-- so the slower cadence still guarantees a tick inside the send band:
--   send-photo-cadence   band [target-10, target+30] = 40 min  → */15 safe
--   send-details-reminder 12h minimum gap between cron sends   → */30 safe
--   the reconcile/sync jobs are backstops for realtime triggers, so a longer
--   interval costs freshness, not correctness.

do $$
declare
  target record;
begin
  for target in
    select *
    from (values
      -- Sweeps that almost always find nothing.
      ('escalate-stale-leads-every-minute',        '*/10 * * * *'),
      ('airtable-inbound-poll',                    '*/15 * * * *'),
      ('airtable-sync-watchdog',                   '0 * * * *'),
      -- CRM / calendar reconcilers. Realtime triggers are the primary path;
      -- these only catch what those missed.
      ('reconcile-ghl-every-5min',                 '*/30 * * * *'),
      ('reconcile-ghl-appointments-every-5min',    '*/30 * * * *'),
      ('sync-google-calendar-every-15min',         '*/30 * * * *'),
      ('reconcile-google-calendar-every-10min',    '*/30 * * * *'),
      ('reconcile-booking-agreements-every-10min', '*/30 * * * *'),
      ('talent-sync-every-10min',                  '*/30 * * * *'),
      ('qc-drive-mirror',                          '*/30 * * * *'),
      -- Reminder sweeps with wide enough send windows to tolerate this.
      ('send-details-reminder-every-5min',         '*/30 * * * *'),
      ('send-photo-cadence',                       '*/15 * * * *'),
      ('send-rating-reminders',                    '*/30 * * * *')
    ) as t(jobname, new_schedule)
  loop
    if exists (select 1 from cron.job where jobname = target.jobname) then
      perform cron.alter_job(
        (select jobid from cron.job where jobname = target.jobname),
        schedule => target.new_schedule
      );
      raise notice 'rescheduled % -> %', target.jobname, target.new_schedule;
    else
      raise notice 'skipped % (not scheduled here)', target.jobname;
    end if;
  end loop;
end $$;
