-- ─── Email-keyed customer credit (visibility + spend) ──────────────────────
--
-- Problem: credits are granted against a single customers.id, but the customer
-- portal, the live booking flow, and the capture-time deduction all resolved a
-- customer row by email and then queried strictly by that customer_id. When the
-- credited customer row differs from the one resolved at read time (duplicate
-- customer rows, email-casing mismatches, or a booking whose customer_id is a
-- Stripe `cus_…` id rather than a uuid) the credit was invisible and never
-- deducted.
--
-- Fix: resolve credits by EMAIL (case-insensitive) across every customer row
-- and credit row that shares the address. customer_credits already stores the
-- gran-time email, so we match on both that column and the set of customer ids
-- with the same email.

-- 1) Email-based balance (same jsonb shape as get_customer_credit_balance)
CREATE OR REPLACE FUNCTION public.get_customer_credit_balance_by_email(_email text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH norm AS (SELECT lower(trim(_email)) AS e),
  ids AS (
    SELECT c.id FROM public.customers c, norm WHERE lower(trim(c.email)) = norm.e
  ),
  cc AS (
    SELECT DISTINCT cr.* FROM public.customer_credits cr, norm
    WHERE (cr.email IS NOT NULL AND lower(trim(cr.email)) = norm.e)
       OR cr.customer_id IN (SELECT id FROM ids)
  )
  SELECT jsonb_build_object(
    'email', (SELECT e FROM norm),
    'balance_cents', COALESCE(SUM(CASE WHEN status='available' AND (expires_at IS NULL OR expires_at > NOW()) THEN amount_cents ELSE 0 END), 0),
    'lifetime_granted_cents', COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0),
    'lifetime_applied_cents', COALESCE(SUM(CASE WHEN status='applied' THEN amount_cents ELSE 0 END), 0),
    'open_count', COUNT(*) FILTER (WHERE status='available' AND (expires_at IS NULL OR expires_at > NOW()))
  )
  FROM cc;
$function$;

-- 2) Email-based spend at checkout (mirrors apply_customer_credit_to_booking)
CREATE OR REPLACE FUNCTION public.apply_customer_credit_to_booking_by_email(_email text, _booking_id uuid, _max_cents integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  remaining INTEGER := _max_cents;
  total_applied INTEGER := 0;
  consumed_ids UUID[] := ARRAY[]::UUID[];
  row_credit RECORD;
  e TEXT := lower(trim(_email));
BEGIN
  IF _max_cents <= 0 OR e IS NULL OR e = '' THEN
    RETURN jsonb_build_object('applied_cents', 0, 'consumed_ids', '[]'::jsonb);
  END IF;
  FOR row_credit IN
    SELECT id, amount_cents FROM public.customer_credits
    WHERE status = 'available'
      AND amount_cents > 0
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (
        (email IS NOT NULL AND lower(trim(email)) = e)
        OR customer_id IN (SELECT id FROM public.customers WHERE lower(trim(email)) = e)
      )
    ORDER BY COALESCE(expires_at, NOW() + INTERVAL '100 years') ASC, created_at ASC
  LOOP
    EXIT WHEN remaining <= 0;
    DECLARE
      take INTEGER := LEAST(remaining, row_credit.amount_cents);
    BEGIN
      IF take = row_credit.amount_cents THEN
        UPDATE public.customer_credits
        SET status = 'applied', applied_at = NOW(), applied_to_booking_id = _booking_id, updated_at = NOW()
        WHERE id = row_credit.id;
      ELSE
        UPDATE public.customer_credits
        SET amount_cents = amount_cents - take, updated_at = NOW()
        WHERE id = row_credit.id;
        INSERT INTO public.customer_credits (customer_id, email, amount_cents, source, status, reason, applied_at, applied_to_booking_id)
        SELECT customer_id, email, take, source, 'applied', COALESCE(reason,'partial spend'), NOW(), _booking_id
        FROM public.customer_credits WHERE id = row_credit.id;
      END IF;
      consumed_ids := consumed_ids || row_credit.id;
      total_applied := total_applied + take;
      remaining := remaining - take;
    END;
  END LOOP;

  IF total_applied > 0 AND _booking_id IS NOT NULL THEN
    UPDATE public.bookings
    SET applied_credit_cents = COALESCE(applied_credit_cents, 0) + total_applied,
        updated_at = NOW()
    WHERE id = _booking_id;
  END IF;

  RETURN jsonb_build_object('applied_cents', total_applied, 'consumed_ids', to_jsonb(consumed_ids));
END $function$;

-- 3) Deduct at confirm/complete by EMAIL so the spend no longer depends on
--    bookings.customer_id being a uuid that matches the credited row.
CREATE OR REPLACE FUNCTION public.auto_apply_wallet_credit_on_confirm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  already_applied INT;
BEGIN
  IF NEW.status NOT IN ('confirmed','completed') THEN RETURN NEW; END IF;
  IF COALESCE(NEW.applied_credit_cents, 0) <= 0 THEN RETURN NEW; END IF;
  IF NEW.email IS NULL OR trim(NEW.email) = '' THEN RETURN NEW; END IF;

  -- Only fire on the transition INTO confirmed/completed (or when the reserved
  -- credit amount changes).
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.applied_credit_cents IS NOT DISTINCT FROM NEW.applied_credit_cents THEN
    RETURN NEW;
  END IF;

  -- Idempotency: skip if any credit row is already 'applied' against this booking
  SELECT COUNT(*) INTO already_applied FROM public.customer_credits
    WHERE applied_to_booking_id = NEW.id AND status = 'applied';
  IF already_applied > 0 THEN RETURN NEW; END IF;

  BEGIN
    PERFORM public.apply_customer_credit_to_booking_by_email(
      NEW.email,
      NEW.id,
      NEW.applied_credit_cents
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'auto_apply_wallet_credit_on_confirm failed for booking %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $function$;

-- 4) Backfill: stamp email on any legacy credit rows that are missing it so
--    the email match catches everything granted before this change.
UPDATE public.customer_credits cc
SET email = c.email
FROM public.customers c
WHERE cc.customer_id = c.id
  AND (cc.email IS NULL OR trim(cc.email) = '')
  AND c.email IS NOT NULL;

GRANT EXECUTE ON FUNCTION public.get_customer_credit_balance_by_email(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_customer_credit_to_booking_by_email(text, uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
