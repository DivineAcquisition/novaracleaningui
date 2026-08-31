-- Add skillset column to cleaners table
ALTER TABLE cleaners 
ADD COLUMN IF NOT EXISTS skillset text[] DEFAULT '{}';