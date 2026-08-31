-- Make the booking agreement send reliable + exactly-once (applied live).
-- 1) Enforce one agreement per booking (dedupe first).
delete from public.docuseal_submissions a
 using public.docuseal_submissions b
 where a.booking_id = b.booking_id
   and a.booking_id is not null
   and a.created_at < b.created_at;

create unique index if not exists docuseal_submissions_booking_uniq
  on public.docuseal_submissions (booking_id)
  where booking_id is not null;

-- 2) Reconcile cron: catch any confirmed/completed booking (last 14 days) that
-- still has no agreement (trigger failure, VA/portal insert, cold start). The
-- route claims atomically + is idempotent, so this never double-sends.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-booking-agreements-every-10min') then
    perform cron.unschedule('reconcile-booking-agreements-every-10min');
  end if;
end $$;

select cron.schedule(
  'reconcile-booking-agreements-every-10min',
  '*/10 * * * *',
  $cron$
    select net.http_post(
      url := (select value from public.app_secrets where key='BOOKING_AGREEMENT_URL') || '?secret=' || (select value from public.app_secrets where key='BOOKING_AGREEMENT_SECRET'),
      body := jsonb_build_object('bookingId', b.id),
      headers := jsonb_build_object('Content-Type','application/json'),
      timeout_milliseconds := 30000
    )
    from public.bookings b
    where b.status in ('confirmed','completed')
      and b.email is not null and b.email <> ''
      and b.created_at >= now() - interval '14 days'
      and not exists (select 1 from public.docuseal_submissions d where d.booking_id = b.id)
    limit 50;
  $cron$
);
