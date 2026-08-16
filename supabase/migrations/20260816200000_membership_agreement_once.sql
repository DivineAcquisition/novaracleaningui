-- Membership / recurring visits must never receive the one-time Service
-- Agreement. That document is per booking; members get the Recurring Service
-- & Membership Agreement once (at purchase or when the plan is initiated).
--
-- 1) Unique claim so ensure-agreement is exactly-once per email.
-- 2) Confirm trigger skips the one-time DocuSeal POST for membership visits
--    (confirmation email/SMS fan-out is unchanged).
-- 3) Reconcile cron skips those same visits so generated recurring cleans
--    stop looking like "unsigned one-time bookings".
-- 4) URL for the membership ensure route (reuses BOOKING_AGREEMENT_SECRET).

insert into public.app_secrets (key, value, description) values
  (
    'MEMBERSHIP_AGREEMENT_URL',
    'https://try.novaracleaning.com/api/memberships/ensure-agreement',
    'URL of the membership-agreement ensure route (once per email; Stripe / generator / backfill).'
  )
on conflict (key) do nothing;

create unique index if not exists docuseal_submissions_membership_email_uniq
  on public.docuseal_submissions (lower(submitter_email))
  where audience = 'membership'
    and coalesce(status, '') is distinct from 'failed';

create or replace function public.notify_booking_confirm_fanout()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
declare
  agr_url text;
  agr_secret text;
  req_id bigint;
  membership_visit boolean;
begin
  if tg_op = 'UPDATE' and NEW.status = 'confirmed' and OLD.status is distinct from 'confirmed' then
    begin
      select net.http_post(
        url := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/booking-confirm-comms',
        body := jsonb_build_object('bookingId', NEW.id),
        headers := jsonb_build_object('Content-Type','application/json'),
        timeout_milliseconds := 30000
      ) into req_id;
    exception when others then req_id := null; end;

    membership_visit :=
      NEW.recurring_schedule_id is not null
      or coalesce(NEW.booking_channel, '') = 'recurring'
      or (
        NEW.membership_plan is not null
        and btrim(NEW.membership_plan) <> ''
        and lower(btrim(NEW.membership_plan)) <> 'none'
      );

    -- One-time Service Agreement only. Membership visits are handled by
    -- /api/memberships/ensure-agreement at purchase / schedule create.
    if not membership_visit then
      begin
        select value into agr_url from public.app_secrets where key = 'BOOKING_AGREEMENT_URL';
        select value into agr_secret from public.app_secrets where key = 'BOOKING_AGREEMENT_SECRET';
        if agr_url is not null and length(trim(agr_url)) > 0 and agr_secret is not null and length(trim(agr_secret)) > 0 then
          select net.http_post(
            url := trim(agr_url) || '?secret=' || agr_secret,
            body := jsonb_build_object('bookingId', NEW.id),
            headers := jsonb_build_object('Content-Type','application/json'),
            timeout_milliseconds := 30000
          ) into req_id;
        end if;
      exception when others then req_id := null; end;
    end if;
  end if;
  return NEW;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'reconcile-booking-agreements-every-10min') then
    perform cron.unschedule('reconcile-booking-agreements-every-10min');
  end if;
end $$;

select cron.schedule(
  'reconcile-booking-agreements-every-10min',
  '*/30 * * * *',
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
      and b.recurring_schedule_id is null
      and coalesce(b.booking_channel, '') is distinct from 'recurring'
      and (
        b.membership_plan is null
        or btrim(b.membership_plan) = ''
        or lower(btrim(b.membership_plan)) = 'none'
      )
    limit 50;
  $cron$
);
