-- SMS Response Tracking Migration
-- Adds tables and columns for tracking SMS confirmations and customer responses

-- Create sms_responses table to track incoming SMS
CREATE TABLE IF NOT EXISTS public.sms_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_phone TEXT NOT NULL,
  to_phone TEXT,
  message TEXT NOT NULL,
  provider_message_id TEXT,
  action_detected TEXT,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,
  response_sent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for phone lookups
CREATE INDEX IF NOT EXISTS idx_sms_responses_from_phone ON public.sms_responses(from_phone);
CREATE INDEX IF NOT EXISTS idx_sms_responses_booking_id ON public.sms_responses(booking_id);
CREATE INDEX IF NOT EXISTS idx_sms_responses_created_at ON public.sms_responses(created_at DESC);

-- Add SMS tracking columns to bookings table
ALTER TABLE public.bookings 
ADD COLUMN IF NOT EXISTS confirmation_sms_sent BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS confirmation_sms_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reminder_sms_sent BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS reminder_sms_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS customer_confirmed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS customer_confirmed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reschedule_requested BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS reschedule_requested_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Add provider column to sms_logs if it doesn't exist
ALTER TABLE public.sms_logs
ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'messagebird',
ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL;

-- Add sms_opt_out column to customers table
ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS sms_opt_out BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS sms_opt_out_at TIMESTAMPTZ;

-- Enable RLS on sms_responses
ALTER TABLE public.sms_responses ENABLE ROW LEVEL SECURITY;

-- Allow service role to manage sms_responses
CREATE POLICY "Service role can manage sms_responses"
ON public.sms_responses
FOR ALL
USING (true)
WITH CHECK (true);

-- Create a view for SMS analytics
CREATE OR REPLACE VIEW public.sms_analytics AS
SELECT 
  DATE(created_at) as date,
  action_detected,
  COUNT(*) as count,
  COUNT(CASE WHEN processed THEN 1 END) as processed_count
FROM public.sms_responses
GROUP BY DATE(created_at), action_detected
ORDER BY date DESC, action_detected;

-- Grant access to authenticated users for the view
GRANT SELECT ON public.sms_analytics TO authenticated;

-- Comment on table
COMMENT ON TABLE public.sms_responses IS 'Tracks incoming SMS responses from customers for booking management';
