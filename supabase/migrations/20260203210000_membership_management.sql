-- Membership Management Migration
-- Adds fields for pause, cancel, and subscription tracking

-- Add membership management columns to membership_credits
ALTER TABLE public.membership_credits
ADD COLUMN IF NOT EXISTS subscription_id TEXT,
ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS resumes_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Create index for subscription lookups
CREATE INDEX IF NOT EXISTS idx_membership_credits_subscription_id 
ON public.membership_credits(subscription_id);

-- Create subscription_events table for tracking changes
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  reason TEXT,
  email TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for subscription events
CREATE INDEX IF NOT EXISTS idx_subscription_events_subscription_id 
ON public.subscription_events(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_created_at 
ON public.subscription_events(created_at DESC);

-- Enable RLS on subscription_events
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

-- Allow service role to manage subscription_events
CREATE POLICY "Service role can manage subscription_events"
ON public.subscription_events
FOR ALL
USING (true)
WITH CHECK (true);

-- Add cancellation fields to bookings if not exists
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS refund_amount_cents INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS refund_type TEXT;

-- Create a function to restore booking credit
CREATE OR REPLACE FUNCTION public.restore_booking_credit(p_booking_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT;
  v_uses_credit BOOLEAN;
BEGIN
  -- Get booking details
  SELECT email, uses_credit INTO v_email, v_uses_credit
  FROM public.bookings
  WHERE id = p_booking_id;

  IF v_uses_credit THEN
    -- Restore the credit
    UPDATE public.membership_credits
    SET 
      credits_remaining = credits_remaining + 1,
      credits_used = GREATEST(credits_used - 1, 0)
    WHERE email = v_email;
  END IF;
END;
$$;

-- Create addresses table if it doesn't exist (for member booking)
CREATE TABLE IF NOT EXISTS public.addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  street TEXT NOT NULL,
  unit TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  sqft_tier TEXT,
  bedrooms INTEGER,
  bathrooms NUMERIC(3,1),
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for customer addresses
CREATE INDEX IF NOT EXISTS idx_addresses_customer_id 
ON public.addresses(customer_id);

-- Enable RLS on addresses
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view/manage their addresses
CREATE POLICY "Users can manage own addresses"
ON public.addresses
FOR ALL
USING (
  customer_id IN (
    SELECT id FROM public.customers 
    WHERE email = auth.jwt() ->> 'email'
  )
)
WITH CHECK (
  customer_id IN (
    SELECT id FROM public.customers 
    WHERE email = auth.jwt() ->> 'email'
  )
);

-- Allow service role to manage all addresses
CREATE POLICY "Service role can manage addresses"
ON public.addresses
FOR ALL
USING (true)
WITH CHECK (true);

-- Comment on tables
COMMENT ON TABLE public.subscription_events IS 'Tracks subscription lifecycle events (pause, cancel, resume, etc.)';
COMMENT ON TABLE public.addresses IS 'Customer saved addresses for faster booking';
