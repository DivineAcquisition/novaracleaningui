-- ─── bookings.pay_basis_cents ───────────────────────────────────────────────
--
-- Cleaner pay is normally a share of the final approved job value, and that
-- works because the customer charge and the value of the work are the same
-- number. There are two places where they are not:
--
--   • A re-clean charges the customer $0. Pay already has an exception for
--     that: reclean_assessed_value_cents.
--
--   • A property manager's portfolio volume discount is subtracted from what
--     the manager pays and from nothing else. The discount is funded from
--     Company margin; it is not a pay cut for the person doing the work. So
--     final_charge_cents on a turnover is BELOW the value of the job.
--
-- This column is the general form of that idea: when it is set, it is the
-- value pay is computed from, whatever the customer was charged. Left null on
-- ordinary bookings, where the charge is the value and nothing changes.
--
-- It moves upward with an approved scope adjustment, because the crew did the
-- heavier work. It never moves downward for a discount, credit, or goodwill
-- reduction, because none of those are things the crew did.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pay_basis_cents integer;

COMMENT ON COLUMN public.bookings.pay_basis_cents IS
  'Value cleaner pay is computed from when it differs from the customer charge '
  '(e.g. a property-manager turnover whose portfolio discount is margin-funded). '
  'Null on ordinary bookings, where final_charge_cents is the pay basis.';

CREATE INDEX IF NOT EXISTS bookings_pay_basis_cents_idx
  ON public.bookings (pay_basis_cents)
  WHERE pay_basis_cents IS NOT NULL;
