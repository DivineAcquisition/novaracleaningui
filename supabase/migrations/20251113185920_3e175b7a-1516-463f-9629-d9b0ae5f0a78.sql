-- Add missing fields to bookings table for Zapier integration
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS booking_channel text DEFAULT 'Website',
ADD COLUMN IF NOT EXISTS booker_source text DEFAULT 'New Lead',
ADD COLUMN IF NOT EXISTS access_notes text,
ADD COLUMN IF NOT EXISTS team_notes text,
ADD COLUMN IF NOT EXISTS dispatch_notes text,
ADD COLUMN IF NOT EXISTS frequency text DEFAULT 'One-Time',
ADD COLUMN IF NOT EXISTS sqft integer,
ADD COLUMN IF NOT EXISTS arrival_window text,
ADD COLUMN IF NOT EXISTS estimated_duration_hours integer,
ADD COLUMN IF NOT EXISTS check_in_time timestamp with time zone,
ADD COLUMN IF NOT EXISTS check_out_time timestamp with time zone,
ADD COLUMN IF NOT EXISTS before_photos text[],
ADD COLUMN IF NOT EXISTS after_photos text[],
ADD COLUMN IF NOT EXISTS issues_flag boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS issues_notes text,
ADD COLUMN IF NOT EXISTS cancel_reason text,
ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'Card',
ADD COLUMN IF NOT EXISTS tax_cents integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS tip_cents integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS cleaner_hourly_rate_cents integer DEFAULT 2000;

-- Create webhook failures tracking table
CREATE TABLE IF NOT EXISTS webhook_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  booking_id uuid REFERENCES bookings(id),
  webhook_url text NOT NULL,
  payload jsonb NOT NULL,
  error_message text,
  retry_count integer DEFAULT 0,
  resolved boolean DEFAULT false
);

-- Enable RLS on webhook_failures
ALTER TABLE webhook_failures ENABLE ROW LEVEL SECURITY;

-- Admin can manage webhook failures
CREATE POLICY "Admins can manage webhook failures"
  ON webhook_failures
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));