-- SMS retry queue for failed SMS messages (mirrors email_retry_queue pattern)
CREATE TABLE IF NOT EXISTS public.sms_retry_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sms_log_id UUID REFERENCES public.sms_logs(id) ON DELETE SET NULL,
  to_phone TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  job_assignment_id UUID REFERENCES public.job_assignments(id) ON DELETE SET NULL,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_error TEXT,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  next_retry_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'sent', 'failed', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_sms_retry_queue_status ON public.sms_retry_queue(status);
CREATE INDEX idx_sms_retry_queue_next_retry ON public.sms_retry_queue(next_retry_at) WHERE status IN ('pending', 'retrying');
CREATE INDEX idx_sms_retry_queue_phone ON public.sms_retry_queue(to_phone);

ALTER TABLE public.sms_retry_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage SMS retry queue"
  ON public.sms_retry_queue
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Add delivery tracking columns to sms_logs
ALTER TABLE public.sms_logs
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS carrier TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Rate limiting: track SMS sends per phone per time window
CREATE INDEX IF NOT EXISTS idx_sms_logs_phone_created ON public.sms_logs(to_phone, created_at DESC);

-- Opt-out lookup index for fast consent checks
CREATE INDEX IF NOT EXISTS idx_sms_consent_phone_consent ON public.sms_consent_logs(phone, consent_given, created_at DESC);
