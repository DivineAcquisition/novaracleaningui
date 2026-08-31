-- Add payment_option and full_payment_discount columns to bookings table
ALTER TABLE public.bookings 
ADD COLUMN IF NOT EXISTS payment_option TEXT DEFAULT 'deposit',
ADD COLUMN IF NOT EXISTS full_payment_discount INTEGER DEFAULT 0;

-- Add comments for documentation
COMMENT ON COLUMN public.bookings.payment_option IS 'Payment option selected by customer: deposit or full';
COMMENT ON COLUMN public.bookings.full_payment_discount IS 'Discount amount in cents when paying in full (10% discount)';