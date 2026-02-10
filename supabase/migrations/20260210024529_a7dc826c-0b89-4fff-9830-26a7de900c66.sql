
CREATE OR REPLACE FUNCTION public.reserve_time_slot(_date date, _start_time text, _end_time text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  slot_available boolean;
BEGIN
  UPDATE public.availability_slots
  SET current_bookings = current_bookings + 1
  WHERE service_date = _date
    AND start_time = _start_time::time
    AND current_bookings < max_capacity
  RETURNING true INTO slot_available;
  RETURN COALESCE(slot_available, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_time_slot(_date date, _start_time text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.availability_slots
  SET current_bookings = GREATEST(0, current_bookings - 1)
  WHERE service_date = _date
    AND start_time = _start_time::time;
END;
$$;
