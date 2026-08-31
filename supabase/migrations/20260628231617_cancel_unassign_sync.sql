-- ─── Cancellation → job/assignment cascade ────────────────────────────────
-- Keeps the contractor-facing surfaces in lockstep with the admin Bookings
-- tab. The cleaner dashboards read job_assignments (active statuses only) and
-- the contractor portal reads bookings.status — so when a booking is cancelled
-- we cascade the cancel onto the linked dispatch job + assignments. That drops
-- the job out of every cleaner's ACTIVE list immediately (the contractor portal
-- then shows it greyed as "Cancelled" for 24h before removing it client-side).

CREATE OR REPLACE FUNCTION public.cascade_booking_cancellation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only on the transition INTO cancelled.
  IF NEW.status = 'cancelled' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'cancelled') THEN
    IF NEW.job_id IS NOT NULL THEN
      BEGIN
        UPDATE public.jobs SET status = 'cancelled', updated_at = NOW()
        WHERE id = NEW.job_id AND status IS DISTINCT FROM 'cancelled';
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      BEGIN
        UPDATE public.job_assignments
        SET status = 'cancelled'
        WHERE job_id = NEW.job_id
          AND lower(status) NOT IN ('completed', 'cancelled', 'withdrawn');
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS bookings_cascade_cancellation ON public.bookings;
CREATE TRIGGER bookings_cascade_cancellation
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_booking_cancellation();

NOTIFY pgrst, 'reload schema';
