-- Guarantee every customer gets a unique referral code/link, regardless of
-- which flow created them (customer checkout, internal VA booking, import).
-- Previously the code was only minted by a conditional edge-function call,
-- so customers.referral_code was effectively never populated.

CREATE OR REPLACE FUNCTION public.ensure_customer_referral_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i int;
  tries int := 0;
BEGIN
  IF NEW.referral_code IS NOT NULL AND length(NEW.referral_code) > 0 THEN
    RETURN NEW;
  END IF;
  LOOP
    candidate := '';
    FOR i IN 1..8 LOOP
      candidate := candidate || substr(chars, floor(random() * length(chars))::int + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.customers WHERE referral_code = candidate);
    tries := tries + 1;
    IF tries > 25 THEN
      candidate := candidate || floor(random() * 1000)::text;
      EXIT;
    END IF;
  END LOOP;
  NEW.referral_code := candidate;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_referral_code ON public.customers;
CREATE TRIGGER trg_customer_referral_code
  BEFORE INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.ensure_customer_referral_code();

-- Backfill existing customers missing a code.
DO $backfill$
DECLARE
  r record;
  c text;
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
BEGIN
  FOR r IN SELECT id FROM public.customers WHERE referral_code IS NULL OR referral_code = '' LOOP
    LOOP
      c := '';
      FOR i IN 1..8 LOOP
        c := c || substr(chars, floor(random() * length(chars))::int + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.customers WHERE referral_code = c);
    END LOOP;
    UPDATE public.customers SET referral_code = c WHERE id = r.id;
  END LOOP;
END;
$backfill$;
