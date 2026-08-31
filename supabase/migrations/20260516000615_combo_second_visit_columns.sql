-- 20260516_combo_second_visit_columns.sql
-- Add columns to support the "Deep + Standard Combo" bundle:
--   • offer_type             — distinguishes 'combo' from 'standard'/'deep'/etc.
--   • second_visit_date      — the follow-up Standard Clean date (within 14
--                              days of the Deep Clean) collected on
--                              /book/details after deposit
--   • second_visit_time_slot — display label for the follow-up arrival window
--   • second_visit_start_time / second_visit_end_time — ISO times for the
--                              dispatch / availability slot reservation
--
-- All ADD COLUMNs use IF NOT EXISTS so this is safe to re-run.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS offer_type text,
  ADD COLUMN IF NOT EXISTS second_visit_date date,
  ADD COLUMN IF NOT EXISTS second_visit_time_slot text,
  ADD COLUMN IF NOT EXISTS second_visit_start_time text,
  ADD COLUMN IF NOT EXISTS second_visit_end_time text;

CREATE INDEX IF NOT EXISTS bookings_offer_type_idx ON public.bookings (offer_type);
CREATE INDEX IF NOT EXISTS bookings_second_visit_date_idx ON public.bookings (second_visit_date);
