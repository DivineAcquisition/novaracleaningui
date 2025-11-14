-- Part 1: Add check-in/check-out fields to jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS check_in_time timestamp with time zone;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS check_out_time timestamp with time zone;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS actual_duration_hours numeric;

-- Part 2: Link bookings to jobs (one booking = one job)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id);
CREATE INDEX IF NOT EXISTS idx_bookings_job_id ON bookings(job_id);

-- Part 3: Add cleaner pay tracking to job_assignments
ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS pay_rate_hr numeric DEFAULT 18.00;
ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS estimated_pay_cents integer;

-- Part 4: Performance indexes
CREATE INDEX IF NOT EXISTS idx_job_assignments_check_in ON job_assignments(cleaner_id, status, assigned_at);
CREATE INDEX IF NOT EXISTS idx_jobs_check_in_time ON jobs(start_datetime, check_in_time) WHERE check_in_time IS NOT NULL;