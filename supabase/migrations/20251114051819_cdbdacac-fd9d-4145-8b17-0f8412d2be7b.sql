-- Fix security warnings for function search paths

CREATE OR REPLACE FUNCTION update_cleaner_avg_review()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE cleaners
  SET 
    average_rating = (
      SELECT AVG(rating)::NUMERIC(3,2)
      FROM reviews
      WHERE cleaner_id = NEW.cleaner_id
    ),
    total_ratings = (
      SELECT COUNT(*)
      FROM reviews
      WHERE cleaner_id = NEW.cleaner_id
    )
  WHERE id = NEW.cleaner_id;
  
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION compute_min_cleaners()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sq_ft >= 3000 THEN
    NEW.min_cleaners_required = 3;
  ELSE
    NEW.min_cleaners_required = 2;
  END IF;
  
  RETURN NEW;
END;
$$;