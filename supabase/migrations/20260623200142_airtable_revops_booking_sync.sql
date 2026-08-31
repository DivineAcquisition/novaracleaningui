-- ─── Airtable "Client & Revenue Ops" base — booking auto-sync ────────────────
-- The rich Airtable integration lives in the Next.js app (src/lib/airtable +
-- /api/airtable/sync). Until now NOTHING called that route on booking changes,
-- so reschedules / new bookings never reached the Revenue Ops base — only the
-- GHL pipeline and the (optional) edge "insight mirror" did.
--
-- This trigger POSTs { type: "job", id: <booking uuid> } to the sync route on
-- every booking INSERT or meaningful UPDATE (including a reschedule's
-- service_date / time_slot change). The route upserts the Job (and its linked
-- Client) into Airtable using the existing mappers, so the new date/time is
-- always reflected.
--
-- Fully gated + safe by default: it reads the route URL + shared secret from
-- public.app_secrets and NO-OPS if either is missing, so applying this
-- migration changes nothing until you configure:
--
--   insert into public.app_secrets (key, value) values
--     ('AIRTABLE_SYNC_URL',           'https://try.novaracleaning.com/api/airtable/sync'),
--     ('AIRTABLE_SYNC_WEBHOOK_SECRET','<same value as the app''s AIRTABLE_SYNC_WEBHOOK_SECRET env>')
--   on conflict (key) do update set value = excluded.value;
--
-- The shared secret must match the Next.js env var AIRTABLE_SYNC_WEBHOOK_SECRET.

create or replace function public.notify_airtable_revops_sync()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
declare
  sync_url    text;
  sync_secret text;
  request_id  bigint;
begin
  -- Only fire on INSERT or a change to a field that Airtable cares about.
  -- (Avoids hammering the route on pure GHL/payment-bookkeeping updates.)
  if tg_op = 'UPDATE' then
    if NEW.status               is not distinct from OLD.status
       and NEW.service_date         is not distinct from OLD.service_date
       and NEW.time_slot            is not distinct from OLD.time_slot
       and NEW.service_type         is not distinct from OLD.service_type
       and NEW.email                is not distinct from OLD.email
       and NEW.phone                is not distinct from OLD.phone
       and NEW.first_name           is not distinct from OLD.first_name
       and NEW.last_name            is not distinct from OLD.last_name
       and NEW.total_estimate_cents is not distinct from OLD.total_estimate_cents
       and NEW.final_charge_cents   is not distinct from OLD.final_charge_cents
       and NEW.cleaner_payout_cents is not distinct from OLD.cleaner_payout_cents
       and NEW.payout_status        is not distinct from OLD.payout_status
       and NEW.num_cleaners_assigned is not distinct from OLD.num_cleaners_assigned
       and NEW.membership_plan      is not distinct from OLD.membership_plan
       and NEW.completed_at         is not distinct from OLD.completed_at
    then
      return NEW;
    end if;
  end if;

  select value into sync_url    from public.app_secrets where key = 'AIRTABLE_SYNC_URL';
  select value into sync_secret from public.app_secrets where key = 'AIRTABLE_SYNC_WEBHOOK_SECRET';

  -- Not configured → no-op (safe default).
  if sync_url is null or length(trim(sync_url)) = 0
     or sync_secret is null or length(trim(sync_secret)) = 0 then
    return NEW;
  end if;

  -- Fire-and-forget; never block the booking write.
  begin
    select net.http_post(
      url := trim(sync_url),
      body := jsonb_build_object('type', 'job', 'id', NEW.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-airtable-sync-secret', trim(sync_secret)
      ),
      timeout_milliseconds := 30000
    ) into request_id;
  exception when others then
    request_id := null;
  end;

  return NEW;
end;
$$;

drop trigger if exists notify_airtable_revops_on_booking_change on public.bookings;
create trigger notify_airtable_revops_on_booking_change
  after insert or update on public.bookings
  for each row execute function public.notify_airtable_revops_sync();
