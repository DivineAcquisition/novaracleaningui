-- Add booking_number to track which booking this is for the customer
ALTER TABLE public.bookings
ADD COLUMN booking_number integer DEFAULT 1;

-- Add index for faster customer booking lookups
CREATE INDEX idx_bookings_customer_email ON public.bookings(email);

COMMENT ON COLUMN public.bookings.booking_number IS 'Tracks which booking number this is for the customer (1st, 2nd, 3rd, etc.)';