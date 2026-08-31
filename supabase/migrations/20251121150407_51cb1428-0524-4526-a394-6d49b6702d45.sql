-- Add pets field to bookings table for property details
ALTER TABLE public.bookings 
ADD COLUMN pets TEXT;

-- Add comment for clarity
COMMENT ON COLUMN public.bookings.pets IS 'Type of pets at property: none, dog, cat, multiple, other';