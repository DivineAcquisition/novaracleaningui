-- ─── Auto-send the Maintenance Cleaning Checklist on every standard ─────
-- ─── booking (and never twice for the same booking) ─────────────────────
--
-- Two pieces:
--
--   1. booking_emails_sent — append-only ledger of every transactional
--      email we've fired against a booking, keyed by (booking_id, kind).
--      Lets every email-fan-out path use a single idempotency check
--      instead of stamping booleans onto the bookings row for every new
--      kind we add (we already have confirmation_email_sent flags, but
--      the table approach scales without ALTER TABLE pressure).
--
--   2. trigger_send_maintenance_checklist — AFTER INSERT/UPDATE on
--      bookings. Fires send-cleaning-checklist via pg_net the FIRST time
--      a booking row has service_type='standard' AND status in
--      ('confirmed','assigned','in_progress','completed'). Confirmation
--      can arrive via several paths (Stripe checkout success, admin
--      manual booking, VA-booking, finalize-booking auto-trigger) so
--      the DB-level trigger guarantees the email goes out exactly once
--      per booking regardless of which path actually flips the status.

create table if not exists public.booking_emails_sent (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null,
  recipient_email text,
  provider_message_id text,
  sent_at timestamptz not null default now(),
  unique (booking_id, kind)
);

create index if not exists booking_emails_sent_booking_kind_idx
  on public.booking_emails_sent (booking_id, kind);

-- Reuse the same anon key the other pg_net triggers already use. The
-- send-cleaning-checklist function falls back to the service role on the
-- function side, so anon is fine here.
create or replace function public.trigger_send_maintenance_checklist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I';
  v_supabase_url text := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  v_request_id bigint;
  v_should_send boolean := false;
begin
  -- Only standard cleanings are in scope for the Maintenance Checklist.
  if lower(coalesce(new.service_type, '')) <> 'standard' then
    return new;
  end if;

  -- Only fire once the booking is actually confirmed (or further along).
  -- 'pending' / 'cancelled' / 'failed' don't qualify.
  if lower(coalesce(new.status, '')) not in
       ('confirmed','assigned','in_progress','completed') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Brand new booking that was inserted ALREADY in a confirmed-ish
    -- state (admin manual bookings, VA path). Fire.
    v_should_send := true;
  elsif tg_op = 'UPDATE' then
    -- Transitioned INTO a sendable state from somewhere else. Only fire
    -- once on that transition.
    if lower(coalesce(old.status, '')) not in
         ('confirmed','assigned','in_progress','completed')
       or lower(coalesce(old.service_type, '')) <> 'standard' then
      v_should_send := true;
    end if;
  end if;

  if not v_should_send then
    return new;
  end if;

  -- Idempotency: skip if we've already stamped a maintenance_checklist row
  -- for this booking. The function ALSO checks this before sending; the
  -- duplicate check here is purely a load-shedding optimization to avoid
  -- pg_net round-trips.
  if exists (
    select 1 from public.booking_emails_sent
    where booking_id = new.id and kind = 'maintenance_checklist'
  ) then
    return new;
  end if;

  begin
    select net.http_post(
      url := v_supabase_url || '/functions/v1/send-cleaning-checklist',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key
      ),
      body := jsonb_build_object(
        'bookingId', new.id::text,
        'source', 'db_trigger',
        'op', tg_op
      ),
      timeout_milliseconds := 30000
    ) into v_request_id;
    -- Log for debugging — non-blocking
    raise notice 'maintenance checklist queued booking=% request=%', new.id, v_request_id;
  exception when others then
    -- Never block the booking write because the email queue is sick.
    raise warning 'maintenance checklist queue failed booking=% sqlstate=% msg=%',
      new.id, sqlstate, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists bookings_send_maintenance_checklist on public.bookings;
create trigger bookings_send_maintenance_checklist
  after insert or update of status, service_type
  on public.bookings
  for each row
  execute function public.trigger_send_maintenance_checklist();

comment on trigger bookings_send_maintenance_checklist on public.bookings is
  'Auto-fires send-cleaning-checklist via pg_net the first time a booking row is/becomes service_type=standard AND status in (confirmed,assigned,in_progress,completed). Idempotency is enforced by the unique (booking_id, kind) index on booking_emails_sent.';
