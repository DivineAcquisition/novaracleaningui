-- Per-booking opt-out for post-job review / feedback requests.
-- When true, send-rating-reminders skips the first feedback SMS/email and
-- any follow-up nudges for that booking. Past jobs keep their history;
-- this only blocks future sends.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS suppress_review_request boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bookings.suppress_review_request IS
  'When true, do not send the post-job feedback / review request (SMS + email) or follow-up nudges for this booking.';

CREATE INDEX IF NOT EXISTS bookings_suppress_review_request_idx
  ON public.bookings (suppress_review_request)
  WHERE suppress_review_request = true;
