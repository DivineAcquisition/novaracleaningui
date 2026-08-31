-- Restore public-funnel confirmation comms + auto-send the one-time agreement.
-- The auto-finalize trigger pre-confirms, so finalize-booking no-ops and the
-- post-confirm fan-out (confirmation email/SMS/account SMS/dispatch) is skipped.
-- This AFTER-UPDATE trigger fires the self-contained booking-confirm-comms
-- function AND the DocuSeal one-time agreement route on the confirm transition.
-- Both are idempotent. (applied live 2026-06-24)
insert into public.app_secrets (key, value, description) values
  ('BOOKING_AGREEMENT_SECRET', encode(gen_random_bytes(24),'hex'), 'Shared secret for /api/bookings/send-agreement (DB trigger -> DocuSeal one-time agreement on booking confirm).'),
  ('BOOKING_AGREEMENT_URL', 'https://try.novaracleaning.com/api/bookings/send-agreement', 'URL of the booking agreement auto-send route.')
on conflict (key) do nothing;

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
  return NEW;
end;
$$;

drop trigger if exists notify_booking_confirm_fanout on public.bookings;
create trigger notify_booking_confirm_fanout
  after update on public.bookings
  for each row execute function public.notify_booking_confirm_fanout();
