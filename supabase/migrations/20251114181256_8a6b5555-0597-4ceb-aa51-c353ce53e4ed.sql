-- Create table for cleaner onboarding PIN codes
CREATE TABLE IF NOT EXISTS public.cleaner_onboarding_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pin_code text NOT NULL UNIQUE,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cleaner_onboarding_pins ENABLE ROW LEVEL SECURITY;

-- Admin can manage PIN codes
CREATE POLICY "Admins can manage PIN codes"
ON public.cleaner_onboarding_pins
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);

-- Anyone can check if a PIN is valid (for onboarding)
CREATE POLICY "Anyone can validate PIN codes"
ON public.cleaner_onboarding_pins
FOR SELECT
USING (is_active = true);

-- Insert a default PIN for testing (can be changed by admin)
INSERT INTO public.cleaner_onboarding_pins (pin_code)
VALUES ('1234')
ON CONFLICT (pin_code) DO NOTHING;