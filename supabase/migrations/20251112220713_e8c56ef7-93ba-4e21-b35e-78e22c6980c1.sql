-- Create email retry queue table
CREATE TABLE IF NOT EXISTS email_retry_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  email_type TEXT NOT NULL CHECK (email_type IN ('confirmation', 'reminder', 'modification', 'cancellation')),
  recipient_email TEXT NOT NULL,
  email_data JSONB NOT NULL,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_error TEXT,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'sent', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sent_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for efficient querying
CREATE INDEX idx_email_retry_queue_status ON email_retry_queue(status);
CREATE INDEX idx_email_retry_queue_next_retry ON email_retry_queue(next_retry_at) WHERE status = 'pending';
CREATE INDEX idx_email_retry_queue_booking ON email_retry_queue(booking_id);

-- Enable RLS
ALTER TABLE email_retry_queue ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins can view retry queue
CREATE POLICY "Admins can manage email retry queue"
  ON email_retry_queue
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));