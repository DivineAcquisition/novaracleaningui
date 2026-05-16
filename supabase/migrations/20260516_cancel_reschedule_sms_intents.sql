-- ─── Booking lifecycle timestamps + fee tracking ──────────────────────────
-- Adds columns the cancel + reschedule flows need to surface the right
-- copy in receipts / GHL syncs / dispatch tools.
alter table public.bookings
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_fee_cents integer not null default 0,
  add column if not exists rescheduled_at timestamptz,
  add column if not exists rescheduled_from_date date,
  add column if not exists rescheduled_from_time_slot text,
  add column if not exists reschedule_fee_cents integer not null default 0,
  add column if not exists reschedule_count integer not null default 0;

create index if not exists idx_bookings_cancelled_at on public.bookings (cancelled_at);
create index if not exists idx_bookings_rescheduled_at on public.bookings (rescheduled_at);

-- ─── SMS reply state (R / C → YES flow) ──────────────────────────────────
-- Lightweight intent table the inbound Telnyx webhook uses to track
-- a pending "cancel" or "reschedule" conversation. Expires in 15 min so
-- stale prompts don't trigger unexpected actions.
create table if not exists public.sms_intents (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  booking_id uuid references public.bookings(id) on delete cascade,
  intent text not null check (intent in ('cancel_pending','reschedule_pending')),
  fee_cents integer not null default 0,
  status text not null default 'awaiting_confirmation'
    check (status in ('awaiting_confirmation','confirmed','declined','expired')),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_sms_intents_phone_created on public.sms_intents (phone, created_at desc);
create index if not exists idx_sms_intents_status on public.sms_intents (status);

-- ─── Inbound SMS message log ─────────────────────────────────────────────
-- Every Telnyx `message.received` body is recorded for audit / dispute
-- handling. `processed_action` describes what we did in response.
create table if not exists public.sms_inbound_log (
  id uuid primary key default gen_random_uuid(),
  from_phone text not null,
  to_phone text,
  message_text text,
  provider_message_id text,
  matched_booking_id uuid references public.bookings(id) on delete set null,
  processed_action text,
  reply_sent text,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sms_inbound_log_from_phone on public.sms_inbound_log (from_phone, created_at desc);
