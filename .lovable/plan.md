

# Fix: Type Mismatch in reserve_time_slot Function

## Root Cause

The `availability_slots.start_time` column has type `time without time zone`, but the `reserve_time_slot` function accepts `_start_time` as `text`. PostgreSQL cannot compare `time without time zone = text` without an explicit cast, causing error `42883`.

The same issue exists in `release_time_slot`.

## Fix

Run a migration to recreate both functions with explicit casts from `text` to `time`:

```sql
-- reserve_time_slot: cast _start_time and _end_time to time
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

-- release_time_slot: cast _start_time to time
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
```

## Files Changed

| File | Change |
|------|--------|
| Database migration | Add `::time` casts in `reserve_time_slot` and `release_time_slot` functions |

## Expected Result

The `start_time = _start_time::time` comparison will work correctly, the time slot reservation will succeed, and the Stripe payment form will load.

