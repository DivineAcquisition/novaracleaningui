-- ─── Customer / partner before-&-after photo view token ────────────────────
--
-- Adds an open, single-link tokenized view of a job's before/after photos so
-- customers (regular bookings) and partner hosts (STR turnovers) can see the
-- proof-of-work gallery without logging in. The token is minted the moment
-- the cleaner submits photos and is texted/emailed to the customer/host.
--
-- The token lives on the row itself (one job → one gallery). A separate
-- *_sent_at stamp lets the notifying code send the link exactly once.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS photo_view_token   text,
  ADD COLUMN IF NOT EXISTS photo_view_sent_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_photo_view_token_unique
  ON public.bookings (photo_view_token)
  WHERE photo_view_token IS NOT NULL;

ALTER TABLE public.turnover_requests
  ADD COLUMN IF NOT EXISTS photo_view_token   text,
  ADD COLUMN IF NOT EXISTS photo_view_sent_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS turnover_requests_photo_view_token_unique
  ON public.turnover_requests (photo_view_token)
  WHERE photo_view_token IS NOT NULL;

NOTIFY pgrst, 'reload schema';
