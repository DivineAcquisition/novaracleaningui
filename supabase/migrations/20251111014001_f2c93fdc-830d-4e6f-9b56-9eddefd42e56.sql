-- Add email tracking columns to bookings table
ALTER TABLE public.bookings 
ADD COLUMN IF NOT EXISTS confirmation_email_sent boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS confirmation_email_sent_at timestamp with time zone;