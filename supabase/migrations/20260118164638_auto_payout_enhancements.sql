-- Migration: Auto Payout Enhancements
-- Description: Add columns and indexes to support automatic cleaner payouts

-- Add completion_trigger column to bookings table to track how booking was completed
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS completion_trigger TEXT DEFAULT 'manual';

COMMENT ON COLUMN bookings.completion_trigger IS 'How the booking was completed: manual, auto, cleaner_checkout';

-- Add payout tracking columns to cleaners table
ALTER TABLE cleaners 
ADD COLUMN IF NOT EXISTS last_payout_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS pending_payout_cents INTEGER DEFAULT 0;

COMMENT ON COLUMN cleaners.last_payout_at IS 'Timestamp of the last successful payout to this cleaner';
COMMENT ON COLUMN cleaners.pending_payout_cents IS 'Amount in cents of pending payouts (for display purposes)';

-- Create index for payout retry queries (only on failed payouts)
CREATE INDEX IF NOT EXISTS idx_payouts_failed_retry 
ON payouts(status, retry_count, created_at) 
WHERE status = 'failed';

-- Create index for faster lookup of payouts by booking and cleaner
CREATE INDEX IF NOT EXISTS idx_payouts_booking_cleaner 
ON payouts(booking_id, cleaner_id);

-- Add retry_count column to payouts if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payouts' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE payouts ADD COLUMN retry_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add failed_reason column to payouts if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payouts' AND column_name = 'failed_reason'
  ) THEN
    ALTER TABLE payouts ADD COLUMN failed_reason TEXT;
  END IF;
END $$;

-- Create or update the cron job for retrying failed payouts (runs every hour)
-- Note: This requires the pg_cron extension to be enabled
-- If pg_cron is not available, this can be triggered via external scheduler

-- Check if pg_cron extension exists and schedule the job
DO $$
BEGIN
  -- Only create cron job if pg_cron extension is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove existing job if it exists
    PERFORM cron.unschedule('retry-failed-payouts-job');
    
    -- Schedule new job to run every hour
    PERFORM cron.schedule(
      'retry-failed-payouts-job',
      '0 * * * *',  -- Every hour on the hour
      $$
      SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/retry-failed-payouts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
        ),
        body := '{}'::jsonb
      ) AS request_id;
      $$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- If cron scheduling fails, log and continue (can be set up manually)
    RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
END $$;
