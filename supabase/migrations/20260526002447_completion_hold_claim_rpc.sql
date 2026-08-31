-- Atomic claim helper for prepare-completion-hold.
--
-- Atomically transitions a booking row from
-- (NULL | 'pending_retry' | 'expired') -> 'attempting' if attempts < 3.
-- Returns the booking row when claimed, NULL otherwise.
--
-- Replaces a brittle PostgREST .update().or() chain that wasn't reliably
-- matching rows whose completion_hold_status was NULL — switching to a
-- SECURITY DEFINER SQL function makes the claim deterministic and
-- ensures the cron worker always sees eligible rows.
CREATE OR REPLACE FUNCTION public.claim_completion_hold(_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed public.bookings;
BEGIN
  UPDATE public.bookings
     SET completion_hold_status = 'attempting'
   WHERE id = _booking_id
     AND (completion_hold_status IS NULL
          OR completion_hold_status IN ('pending_retry', 'expired'))
     AND completion_hold_attempts < 3
  RETURNING * INTO claimed;
  RETURN claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_completion_hold(uuid) TO service_role;
