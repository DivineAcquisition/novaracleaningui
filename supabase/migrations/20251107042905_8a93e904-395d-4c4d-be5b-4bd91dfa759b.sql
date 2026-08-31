-- Drop existing tables to start fresh with new Novara schema
DROP TABLE IF EXISTS public.bookings CASCADE;
DROP TABLE IF EXISTS public.membership_credits CASCADE;
DROP TABLE IF EXISTS public.custom_quotes CASCADE;

-- Create bookings table for Novara cleaning service
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Customer info
  customer_id TEXT,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  
  -- Address
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  
  -- Service details
  home_size_id TEXT NOT NULL,
  service_type TEXT NOT NULL,
  add_ons TEXT[] DEFAULT '{}',
  
  -- Membership
  membership_plan TEXT DEFAULT 'none',
  uses_credit BOOLEAN DEFAULT false,
  
  -- Schedule
  service_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  
  -- Pricing (in cents)
  base_price_cents INTEGER NOT NULL,
  deposit_cents INTEGER NOT NULL,
  total_estimate_cents INTEGER NOT NULL,
  final_charge_cents INTEGER,
  
  -- Status
  status TEXT DEFAULT 'pending_payment',
  
  -- Stripe references
  checkout_session_id TEXT,
  payment_intent_id TEXT,
  stripe_invoice_id TEXT
);

-- Create membership credits tracking table
CREATE TABLE public.membership_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  customer_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  membership_plan TEXT NOT NULL,
  
  -- Credit tracking
  credits_per_month INTEGER NOT NULL,
  credits_used INTEGER DEFAULT 0,
  credits_remaining INTEGER NOT NULL,
  
  -- Renewal
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  
  -- Stripe subscription ID
  subscription_id TEXT NOT NULL
);

-- Create custom quotes table for >5,000 sqft homes
CREATE TABLE public.custom_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  sqft INTEGER NOT NULL,
  notes TEXT,
  
  status TEXT DEFAULT 'pending'
);

-- Create indexes
CREATE INDEX idx_bookings_email ON public.bookings(email);
CREATE INDEX idx_bookings_status ON public.bookings(status);
CREATE INDEX idx_bookings_service_date ON public.bookings(service_date);
CREATE INDEX idx_bookings_checkout_session ON public.bookings(checkout_session_id);
CREATE INDEX idx_membership_credits_customer_id ON public.membership_credits(customer_id);
CREATE INDEX idx_membership_credits_email ON public.membership_credits(email);
CREATE INDEX idx_custom_quotes_email ON public.custom_quotes(email);
CREATE INDEX idx_custom_quotes_status ON public.custom_quotes(status);

-- Enable RLS
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_quotes ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (public access for now since auth not implemented)
CREATE POLICY "Allow public read access to bookings" ON public.bookings FOR SELECT USING (true);
CREATE POLICY "Allow public insert to bookings" ON public.bookings FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update to bookings" ON public.bookings FOR UPDATE USING (true);

CREATE POLICY "Allow public read access to membership_credits" ON public.membership_credits FOR SELECT USING (true);
CREATE POLICY "Allow public insert to membership_credits" ON public.membership_credits FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update to membership_credits" ON public.membership_credits FOR UPDATE USING (true);

CREATE POLICY "Allow public read access to custom_quotes" ON public.custom_quotes FOR SELECT USING (true);
CREATE POLICY "Allow public insert to custom_quotes" ON public.custom_quotes FOR INSERT WITH CHECK (true);

-- Create trigger to update updated_at timestamp
CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();