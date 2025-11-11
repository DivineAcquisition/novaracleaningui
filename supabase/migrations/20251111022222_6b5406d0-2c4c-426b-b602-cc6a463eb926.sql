-- Create cleaner ratings table
CREATE TABLE IF NOT EXISTS public.cleaner_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  cleaner_id UUID NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(booking_id)
);

-- Create indexes for performance
CREATE INDEX idx_cleaner_ratings_cleaner ON public.cleaner_ratings(cleaner_id);
CREATE INDEX idx_cleaner_ratings_booking ON public.cleaner_ratings(booking_id);

-- Add rating tracking to bookings
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS rating_submitted BOOLEAN DEFAULT FALSE;

-- Add rating stats to cleaners
ALTER TABLE public.cleaners
ADD COLUMN IF NOT EXISTS average_rating NUMERIC(3, 2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS total_ratings INTEGER DEFAULT 0;

-- Enable RLS
ALTER TABLE public.cleaner_ratings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Customers can insert own ratings"
ON public.cleaner_ratings
FOR INSERT
TO authenticated
WITH CHECK (customer_email = (SELECT email FROM auth.users WHERE id = auth.uid()));

CREATE POLICY "Customers can view own ratings"
ON public.cleaner_ratings
FOR SELECT
TO authenticated
USING (customer_email = (SELECT email FROM auth.users WHERE id = auth.uid()));

CREATE POLICY "Cleaners can view ratings about themselves"
ON public.cleaner_ratings
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.cleaners
  WHERE cleaners.id = cleaner_ratings.cleaner_id
  AND cleaners.user_id = auth.uid()
));

CREATE POLICY "Admins can manage all ratings"
ON public.cleaner_ratings
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));