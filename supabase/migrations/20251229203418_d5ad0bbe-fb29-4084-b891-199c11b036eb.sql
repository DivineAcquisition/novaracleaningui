-- Add flooring_type column to bookings table
ALTER TABLE public.bookings 
ADD COLUMN flooring_type text;