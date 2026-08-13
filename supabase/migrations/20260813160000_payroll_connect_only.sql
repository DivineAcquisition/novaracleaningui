-- Payroll is confirmed in Custom Payout / Extra Pay, then paid via Stripe
-- Connect. Stop auto-firing process-payout on booking completion so a
-- contractor is never paid twice (revenue-share transfer + custom amount).

DROP TRIGGER IF EXISTS bookings_auto_payout_on_completion ON public.bookings;
DROP TRIGGER IF EXISTS bookings_auto_payout_on_insert ON public.bookings;

CREATE OR REPLACE FUNCTION public.trigger_auto_payout_on_booking_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No-op. Payouts move only after an admin confirms Custom Payout or Extra
  -- Pay and Stripe Connect has available funds.
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_auto_payout_on_booking_completion() IS
  'Disabled. Contractor payouts are Stripe Connect transfers from Custom Payout / Extra Pay / Run Payroll, not automatic on booking completion.';
