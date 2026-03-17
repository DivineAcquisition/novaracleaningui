-- Add response_token column for secure offer response verification
ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS response_token TEXT;
