-- ─── Booking delays (same-day arrival window push) ────────────────────────────
--
-- A "delay" is a small, admin-driven push of a booking's ARRIVAL WINDOW on the
-- same service_date (1h / 2h / 3h). It's intentionally NOT a reschedule:
-- reschedule swaps the date + slot, notifies via the reschedule pipeline, and
-- charges short-notice fees. A delay keeps the date, rewrites the hourly
-- time_slot label forward by N hours, mirrors the shift onto the job's
-- start_datetime (dispatch clock), stamps an audit trail, and lets the admin
-- attach service-recovery compensation (discount on the total OR a wallet
-- credit) so we don't overload existing endpoints.
--
-- Compensation is intentionally optional — some delays are cosmetic (traffic /
-- prior-job overrun) and don't warrant money changing hands. The admin chooses.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS delay_minutes             integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_reason              text,
  ADD COLUMN IF NOT EXISTS delayed_at                timestamptz,
  ADD COLUMN IF NOT EXISTS delayed_by_user_id        uuid,
  -- The FIRST time_slot before ANY delay hit this booking. Stamped once so a
  -- second bump still shows the true original window (delay_minutes always
  -- reflects the cumulative shift from this baseline).
  ADD COLUMN IF NOT EXISTS pre_delay_time_slot       text,
  -- 'none' | 'discount' | 'credit'
  ADD COLUMN IF NOT EXISTS delay_compensation_type   text
    CHECK (delay_compensation_type IS NULL OR delay_compensation_type IN ('none','discount','credit')),
  ADD COLUMN IF NOT EXISTS delay_compensation_cents  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_credit_id           uuid REFERENCES public.customer_credits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_delayed_at ON public.bookings (delayed_at) WHERE delayed_at IS NOT NULL;

-- ─── Discord routing for delay events (existing events → Discord pipeline) ──
INSERT INTO public.discord_routes (event_type, webhook_key, role_keys, enabled)
VALUES ('booking.delayed', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'], true)
ON CONFLICT (event_type) DO NOTHING;
