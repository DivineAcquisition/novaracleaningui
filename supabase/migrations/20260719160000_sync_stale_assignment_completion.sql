-- Repair: job_assignments / jobs lagged behind bookings.status=completed.
-- Cleaner dashboards filtered Upcoming by assignment status only, so finished
-- jobs kept appearing as active. Align dispatch rows with the booking.

UPDATE public.job_assignments ja
SET status = 'Completed'
FROM public.bookings b
WHERE b.job_id = ja.job_id
  AND lower(b.status) = 'completed'
  AND lower(ja.status) IN (
    'confirmed', 'accepted', 'assigned', 'in progress', 'in_progress'
  );

UPDATE public.jobs j
SET status = 'Completed',
    updated_at = now()
FROM public.bookings b
WHERE b.job_id = j.id
  AND lower(b.status) = 'completed'
  AND lower(coalesce(j.status, '')) NOT IN ('completed', 'cancelled', 'canceled');
