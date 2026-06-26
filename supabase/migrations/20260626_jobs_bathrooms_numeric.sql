-- Fix admin-booking-assign 500s: bookings.bathrooms is numeric (e.g. 1.5/2.5)
-- but public.jobs.bathrooms was integer, so creating a job row for a booking
-- with a fractional bath threw "invalid input syntax for type integer".
-- Widen the column (lossless integer → numeric). Applied live 2026-06-26.
ALTER TABLE public.jobs ALTER COLUMN bathrooms TYPE numeric USING bathrooms::numeric;
NOTIFY pgrst, 'reload schema';
