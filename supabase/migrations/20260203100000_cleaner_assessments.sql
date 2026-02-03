-- Create table for cleaner assessment results
CREATE TABLE IF NOT EXISTS public.cleaner_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id UUID NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  total_questions INTEGER NOT NULL DEFAULT 10,
  passed BOOLEAN NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}',
  attempt_number INTEGER NOT NULL DEFAULT 1,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add index for cleaner lookups
CREATE INDEX IF NOT EXISTS idx_cleaner_assessments_cleaner_id ON public.cleaner_assessments(cleaner_id);

-- Add trained status to cleaners table
ALTER TABLE public.cleaners 
ADD COLUMN IF NOT EXISTS is_trained BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS training_completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS assessment_score INTEGER,
ADD COLUMN IF NOT EXISTS assessment_attempts INTEGER DEFAULT 0;

-- Enable RLS
ALTER TABLE public.cleaner_assessments ENABLE ROW LEVEL SECURITY;

-- Cleaners can view their own assessments
CREATE POLICY "Cleaners can view own assessments"
ON public.cleaner_assessments
FOR SELECT
USING (
  cleaner_id IN (
    SELECT id FROM public.cleaners WHERE user_id = auth.uid()
  )
);

-- Cleaners can insert their own assessments
CREATE POLICY "Cleaners can submit assessments"
ON public.cleaner_assessments
FOR INSERT
WITH CHECK (
  cleaner_id IN (
    SELECT id FROM public.cleaners WHERE user_id = auth.uid()
  )
);

-- Admins can view all assessments
CREATE POLICY "Admins can view all assessments"
ON public.cleaner_assessments
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role = 'admin'
  )
);

-- Function to submit assessment and update cleaner trained status
CREATE OR REPLACE FUNCTION public.submit_cleaner_assessment(
  p_cleaner_id UUID,
  p_answers JSONB,
  p_score INTEGER,
  p_total INTEGER DEFAULT 10
)
RETURNS TABLE(
  assessment_id UUID,
  passed BOOLEAN,
  score INTEGER,
  is_now_trained BOOLEAN
) AS $$
DECLARE
  v_passed BOOLEAN;
  v_attempt_number INTEGER;
  v_assessment_id UUID;
BEGIN
  -- Check if cleaner exists and belongs to current user
  IF NOT EXISTS (
    SELECT 1 FROM public.cleaners 
    WHERE id = p_cleaner_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized or cleaner not found';
  END IF;

  -- Calculate if passed (80% = 8/10)
  v_passed := (p_score::DECIMAL / p_total::DECIMAL) >= 0.8;
  
  -- Get current attempt number
  SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_attempt_number
  FROM public.cleaner_assessments
  WHERE cleaner_id = p_cleaner_id;

  -- Insert assessment record
  INSERT INTO public.cleaner_assessments (
    cleaner_id, score, total_questions, passed, answers, attempt_number
  ) VALUES (
    p_cleaner_id, p_score, p_total, v_passed, p_answers, v_attempt_number
  ) RETURNING id INTO v_assessment_id;

  -- Update cleaner record
  UPDATE public.cleaners
  SET 
    assessment_score = p_score,
    assessment_attempts = v_attempt_number,
    is_trained = CASE WHEN v_passed THEN true ELSE is_trained END,
    training_completed_at = CASE WHEN v_passed AND NOT is_trained THEN now() ELSE training_completed_at END
  WHERE id = p_cleaner_id;

  -- Return result
  RETURN QUERY SELECT 
    v_assessment_id,
    v_passed,
    p_score,
    v_passed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.submit_cleaner_assessment TO authenticated;
