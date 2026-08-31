-- Create SMS consent logs table for audit trail
CREATE TABLE IF NOT EXISTS public.sms_consent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  email TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  consent_given BOOLEAN DEFAULT true,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  revoked_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS on sms_consent_logs
ALTER TABLE public.sms_consent_logs ENABLE ROW LEVEL SECURITY;

-- Allow public to insert consent logs
CREATE POLICY "Anyone can insert consent logs"
ON public.sms_consent_logs
FOR INSERT
TO public
WITH CHECK (true);

-- Admins can view all consent logs
CREATE POLICY "Admins can view all consent logs"
ON public.sms_consent_logs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Users can view their own consent logs
CREATE POLICY "Users can view own consent logs"
ON public.sms_consent_logs
FOR SELECT
TO authenticated
USING (
  phone IN (
    SELECT phone FROM public.cleaners WHERE user_id = auth.uid()
  )
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sms_consent_logs_phone ON public.sms_consent_logs(phone);
CREATE INDEX IF NOT EXISTS idx_sms_consent_logs_email ON public.sms_consent_logs(email);