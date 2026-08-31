-- Add new columns to bookings table for post-payment details collection
ALTER TABLE public.bookings
ADD COLUMN bedrooms INTEGER,
ADD COLUMN bathrooms NUMERIC(2, 1),
ADD COLUMN dwelling_type TEXT;