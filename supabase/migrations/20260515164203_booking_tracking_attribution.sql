-- 20260515_booking_tracking_attribution.sql
-- Add attribution tracking columns to the bookings table so UTM /
-- landing-page / referrer data captured client-side is persisted with
-- the booking and can be replayed to GHL on every booking sync.
--
-- The bag of UTMs lives in a single `tracking` JSONB column. We also
-- mirror the most-queried fields (landing_page, referrer, utm_source,
-- utm_campaign, fbclid, gclid) into dedicated columns so admin reports
-- and SQL filters don't need to dig into the JSON.
--
-- Idempotent: every ADD COLUMN uses IF NOT EXISTS.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS tracking jsonb,
  ADD COLUMN IF NOT EXISTS landing_page text,
  ADD COLUMN IF NOT EXISTS referrer text,
  ADD COLUMN IF NOT EXISTS first_visit_at timestamptz,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS fbclid text,
  ADD COLUMN IF NOT EXISTS gclid text;

CREATE INDEX IF NOT EXISTS bookings_utm_campaign_idx ON public.bookings (utm_campaign);
CREATE INDEX IF NOT EXISTS bookings_utm_source_idx   ON public.bookings (utm_source);

-- waitlist + abandoned_carts already have a few UTM columns, so we
-- only add the tracking bag for consistency. (Safe IF NOT EXISTS.)
ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS tracking jsonb,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS landing_page text,
  ADD COLUMN IF NOT EXISTS referrer text,
  ADD COLUMN IF NOT EXISTS first_visit_at timestamptz,
  ADD COLUMN IF NOT EXISTS fbclid text,
  ADD COLUMN IF NOT EXISTS gclid text;

ALTER TABLE public.abandoned_carts
  ADD COLUMN IF NOT EXISTS tracking jsonb,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS landing_page text,
  ADD COLUMN IF NOT EXISTS referrer text,
  ADD COLUMN IF NOT EXISTS first_visit_at timestamptz,
  ADD COLUMN IF NOT EXISTS fbclid text,
  ADD COLUMN IF NOT EXISTS gclid text;
