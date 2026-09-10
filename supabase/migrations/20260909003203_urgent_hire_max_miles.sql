-- Urgent Hire max miles is 45–55 (default 45). Stored 25mi settings clamp up.

UPDATE public.app_settings
SET
  value = jsonb_set(
    COALESCE(value, '{}'::jsonb),
    '{radius_miles}',
    to_jsonb(
      GREATEST(
        45,
        LEAST(55, COALESCE((value->>'radius_miles')::numeric, 45))
      )
    )
  ),
  description = 'Urgent Hire: max miles (45–55), first-job pay %, fill window, checklist freshness. Payout is job share + 70¢/mi with company take floored at 40%.'
WHERE key = 'urgent_hire_settings';

ALTER TABLE public.urgent_hire_broadcasts
  ALTER COLUMN radius_miles SET DEFAULT 45;
