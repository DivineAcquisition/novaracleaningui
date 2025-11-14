-- Create sms_logs table for tracking SMS delivery
CREATE TABLE public.sms_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  to_phone TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL, -- 'job_offer', 'reminder', 'confirmation'
  job_assignment_id UUID REFERENCES public.job_assignments(id),
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed'
  twilio_sid TEXT,
  error_message TEXT,
  cost DECIMAL(6,4)
);

-- Enable RLS
ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

-- Admin can view all SMS logs
CREATE POLICY "Admins can view all SMS logs"
ON public.sms_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Add SMS preferences to cleaners table
ALTER TABLE public.cleaners
ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS sms_quiet_hours_start TIME,
ADD COLUMN IF NOT EXISTS sms_quiet_hours_end TIME;

-- Index for performance
CREATE INDEX idx_sms_logs_status ON public.sms_logs(status);
CREATE INDEX idx_sms_logs_type ON public.sms_logs(type);
CREATE INDEX idx_sms_logs_created_at ON public.sms_logs(created_at DESC);