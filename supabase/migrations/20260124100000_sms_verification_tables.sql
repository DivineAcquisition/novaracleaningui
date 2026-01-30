-- Phone verification codes table for SMS-based contractor verification
CREATE TABLE IF NOT EXISTS public.phone_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  cleaner_id UUID REFERENCES public.cleaners(id),
  type TEXT NOT NULL DEFAULT 'contractor_verification',
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_phone_verification_codes_phone ON public.phone_verification_codes(phone);
CREATE INDEX IF NOT EXISTS idx_phone_verification_codes_code ON public.phone_verification_codes(code);
CREATE INDEX IF NOT EXISTS idx_phone_verification_codes_cleaner ON public.phone_verification_codes(cleaner_id);

-- Incoming SMS logs for tracking and debugging
CREATE TABLE IF NOT EXISTS public.incoming_sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_phone TEXT NOT NULL,
  message TEXT NOT NULL,
  twilio_message_sid TEXT,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  response_sent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incoming_sms_logs_phone ON public.incoming_sms_logs(from_phone);
CREATE INDEX IF NOT EXISTS idx_incoming_sms_logs_created ON public.incoming_sms_logs(created_at DESC);

-- SMS opt-outs table for compliance
CREATE TABLE IF NOT EXISTS public.sms_opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  cleaner_id UUID REFERENCES public.cleaners(id),
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opted_back_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_opt_outs_phone ON public.sms_opt_outs(phone);

-- Add phone verification fields to cleaners table if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'cleaners' 
    AND column_name = 'phone_verified') THEN
    ALTER TABLE public.cleaners ADD COLUMN phone_verified BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'cleaners' 
    AND column_name = 'phone_verified_at') THEN
    ALTER TABLE public.cleaners ADD COLUMN phone_verified_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add additional columns to sms_logs for tracking
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'sms_logs' 
    AND column_name = 'booking_id') THEN
    ALTER TABLE public.sms_logs ADD COLUMN booking_id UUID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'sms_logs' 
    AND column_name = 'cleaner_id') THEN
    ALTER TABLE public.sms_logs ADD COLUMN cleaner_id UUID REFERENCES public.cleaners(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'sms_logs' 
    AND column_name = 'provider') THEN
    ALTER TABLE public.sms_logs ADD COLUMN provider TEXT DEFAULT 'twilio';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'sms_logs' 
    AND column_name = 'metadata') THEN
    ALTER TABLE public.sms_logs ADD COLUMN metadata JSONB;
  END IF;
END $$;

-- Enable RLS on new tables
ALTER TABLE public.phone_verification_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incoming_sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_opt_outs ENABLE ROW LEVEL SECURITY;

-- RLS policies for phone_verification_codes
CREATE POLICY "Service role can manage phone_verification_codes" ON public.phone_verification_codes
  FOR ALL USING (true) WITH CHECK (true);

-- RLS policies for incoming_sms_logs
CREATE POLICY "Service role can manage incoming_sms_logs" ON public.incoming_sms_logs
  FOR ALL USING (true) WITH CHECK (true);

-- RLS policies for sms_opt_outs
CREATE POLICY "Service role can manage sms_opt_outs" ON public.sms_opt_outs
  FOR ALL USING (true) WITH CHECK (true);

-- Comments for documentation
COMMENT ON TABLE public.phone_verification_codes IS 'Stores SMS verification codes for contractor phone verification';
COMMENT ON TABLE public.incoming_sms_logs IS 'Logs all incoming SMS messages from Twilio webhook';
COMMENT ON TABLE public.sms_opt_outs IS 'Tracks SMS opt-out requests for TCPA compliance';
COMMENT ON COLUMN public.cleaners.phone_verified IS 'Whether the contractor phone number has been verified via SMS';
COMMENT ON COLUMN public.cleaners.phone_verified_at IS 'Timestamp when phone was verified';
