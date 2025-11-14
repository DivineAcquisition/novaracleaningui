-- Add unique constraint to ensure one cleaner profile per auth user
ALTER TABLE cleaners ADD CONSTRAINT cleaners_user_id_unique UNIQUE (user_id);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_cleaners_user_id ON cleaners(user_id) WHERE user_id IS NOT NULL;