-- ─── Cleaner "marked complete" review state ────────────────────────────────
-- When a cleaner taps "Mark complete" in the contractor portal we no longer
-- run the full completion flow (balance charge, payout, customer comms).
-- Instead we move the booking into a lightweight `pending_review` state and
-- stamp who/when so it surfaces in the admin Bookings tab for an admin to
-- finalize. The full completion flow only runs when an admin completes the
-- booking from the admin workspace.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cleaner_marked_complete_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleaner_marked_complete_by uuid;

CREATE INDEX IF NOT EXISTS bookings_pending_review_idx
  ON public.bookings (cleaner_marked_complete_at)
  WHERE status = 'pending_review';

NOTIFY pgrst, 'reload schema';
