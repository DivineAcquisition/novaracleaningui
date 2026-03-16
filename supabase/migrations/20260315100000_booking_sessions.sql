CREATE TABLE IF NOT EXISTS public.booking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '7 days'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'abandoned')),
  current_step TEXT DEFAULT 'zip',
  
  email TEXT,
  phone TEXT,
  first_name TEXT,
  last_name TEXT,
  
  zip_code TEXT,
  city TEXT,
  state TEXT,
  home_size_id TEXT,
  service_type TEXT,
  add_ons TEXT[] DEFAULT '{}',
  membership_plan TEXT DEFAULT 'none',
  use_credit BOOLEAN DEFAULT false,
  service_date DATE,
  time_slot TEXT,
  service_duration NUMERIC,
  payment_option TEXT DEFAULT 'deposit',
  
  address TEXT,
  bedrooms INTEGER,
  bathrooms NUMERIC,
  dwelling_type TEXT,
  
  referral_code TEXT,
  promo_code TEXT,
  booking_data JSONB DEFAULT '{}',
  
  abandoned_cart_id UUID,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  user_agent TEXT,
  ip_address TEXT
);

CREATE INDEX idx_booking_sessions_status ON public.booking_sessions(status);
CREATE INDEX idx_booking_sessions_email ON public.booking_sessions(email);
CREATE INDEX idx_booking_sessions_phone ON public.booking_sessions(phone);
CREATE INDEX idx_booking_sessions_expires ON public.booking_sessions(expires_at) WHERE status = 'active';

ALTER TABLE public.booking_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can create booking sessions"
ON public.booking_sessions FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Anyone can read sessions by id"
ON public.booking_sessions FOR SELECT TO public USING (true);

CREATE POLICY "Anyone can update active sessions"
ON public.booking_sessions FOR UPDATE TO public
USING (status = 'active') WITH CHECK (status IN ('active', 'completed', 'expired', 'abandoned'));

CREATE POLICY "Admins can manage all sessions"
ON public.booking_sessions FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

ALTER TABLE public.abandoned_carts ADD COLUMN IF NOT EXISTS session_id UUID;
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_session ON public.abandoned_carts(session_id);

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS session_id UUID;
CREATE INDEX IF NOT EXISTS idx_bookings_session ON public.bookings(session_id);
