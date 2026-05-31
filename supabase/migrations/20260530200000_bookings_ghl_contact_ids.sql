-- Persist GHL contact + opportunity IDs on bookings so ops-field updates
-- (contractor slots, team size, duration) can PATCH the right contact after
-- dispatch, manual assign, or cleaner accept — without re-searching GHL.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_opportunity_id TEXT;

CREATE INDEX IF NOT EXISTS bookings_ghl_contact_idx
  ON public.bookings(ghl_contact_id)
  WHERE ghl_contact_id IS NOT NULL;
