-- ─── Contractor checklist quality nudge after before photos ───────────────
--
-- When a contractor submits before photos, we text and email them their
-- job checklist and a reminder to work it front-to-end with great quality.
-- The stamp lives on the booking so the send is exactly once even if they
-- submit more before photos later.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS contractor_checklist_nudge_sent_at timestamptz;

NOTIFY pgrst, 'reload schema';
