-- Add reminder tracking columns to job_assignments
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'job_assignments' 
    AND column_name = 'day_before_reminder_sent') THEN
    ALTER TABLE public.job_assignments ADD COLUMN day_before_reminder_sent BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'job_assignments' 
    AND column_name = 'hour_before_reminder_sent') THEN
    ALTER TABLE public.job_assignments ADD COLUMN hour_before_reminder_sent BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'job_assignments' 
    AND column_name = 'check_in_reminder_sent') THEN
    ALTER TABLE public.job_assignments ADD COLUMN check_in_reminder_sent BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Comments for documentation
COMMENT ON COLUMN public.job_assignments.day_before_reminder_sent IS 'Whether the 24-hour reminder SMS has been sent';
COMMENT ON COLUMN public.job_assignments.hour_before_reminder_sent IS 'Whether the 1-hour reminder SMS has been sent';
COMMENT ON COLUMN public.job_assignments.check_in_reminder_sent IS 'Whether the check-in reminder SMS has been sent';
