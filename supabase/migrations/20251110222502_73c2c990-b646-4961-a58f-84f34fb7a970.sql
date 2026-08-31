-- Add approved field to cleaners table
ALTER TABLE public.cleaners 
ADD COLUMN approved BOOLEAN NOT NULL DEFAULT false;

-- Add comment explaining the field
COMMENT ON COLUMN public.cleaners.approved IS 'Admin must approve cleaner before they can create an account';

-- Update existing cleaners to be approved (for backward compatibility)
UPDATE public.cleaners SET approved = true WHERE user_id IS NOT NULL;