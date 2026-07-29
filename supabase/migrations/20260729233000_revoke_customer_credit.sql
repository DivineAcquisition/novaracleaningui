-- ─── Removing account credit without notifying the customer ────────────────
--
-- Until now the only way to take credit back was to insert a negative
-- `customer_credits` row via grant_customer_credit(-amount). That offset row
-- has no expires_at, so once the positive row it was cancelling out expired,
-- the offset kept subtracting and the wallet balance went negative — and the
-- customer-facing wallet listed the removal as an "Account adjustment -$X".
--
-- This RPC instead consumes the available credit rows the same way a checkout
-- spend does (soonest expiry first, splitting a row when the removal is
-- partial) and marks the consumed portion 'revoked', which every balance and
-- spend query already excludes. No offset rows, no notification.

CREATE OR REPLACE FUNCTION public.revoke_customer_credit_by_email(
  _email text,
  _amount_cents integer DEFAULT NULL,
  _reason text DEFAULT NULL,
  _revoked_by uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e TEXT := lower(trim(_email));
  balance_before INTEGER;
  target INTEGER;
  remaining INTEGER;
  total_revoked INTEGER := 0;
  revoked_ids UUID[] := ARRAY[]::UUID[];
  row_credit RECORD;
BEGIN
  IF e IS NULL OR e = '' THEN
    RAISE EXCEPTION 'email required';
  END IF;

  balance_before := COALESCE((
    public.get_customer_credit_balance_by_email(e) ->> 'balance_cents'
  )::INTEGER, 0);

  -- A NULL/non-positive amount means "remove whatever is left". Either way the
  -- removal is capped at the spendable balance so it can never go negative.
  target := LEAST(
    GREATEST(balance_before, 0),
    CASE WHEN _amount_cents IS NULL OR _amount_cents <= 0
         THEN GREATEST(balance_before, 0)
         ELSE _amount_cents END
  );
  remaining := target;

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
        SET status = 'revoked',
            reason = CASE WHEN _reason IS NULL THEN reason
                          ELSE COALESCE(reason || ' — ', '') || 'Removed: ' || _reason END,
            updated_at = NOW()
        WHERE id = row_credit.id;
      ELSE
        UPDATE public.customer_credits
        SET amount_cents = amount_cents - take, updated_at = NOW()
        WHERE id = row_credit.id;
        INSERT INTO public.customer_credits (
          customer_id, email, amount_cents, source, status, reason, granted_by, expires_at, referral_id, booking_id
        )
        SELECT customer_id, email, take, source, 'revoked',
               CASE WHEN _reason IS NULL THEN reason
                    ELSE COALESCE(reason || ' — ', '') || 'Removed: ' || _reason END,
               granted_by, expires_at, referral_id, booking_id
        FROM public.customer_credits WHERE id = row_credit.id;
      END IF;
      revoked_ids := revoked_ids || row_credit.id;
      total_revoked := total_revoked + take;
      remaining := remaining - take;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'email', e,
    'requested_cents', CASE WHEN _amount_cents IS NULL OR _amount_cents <= 0 THEN target ELSE _amount_cents END,
    'revoked_cents', total_revoked,
    'revoked_ids', to_jsonb(revoked_ids),
    'balance_cents_before', balance_before,
    'balance_cents_after', balance_before - total_revoked,
    'revoked_by', _revoked_by
  );
END $function$;

COMMENT ON FUNCTION public.revoke_customer_credit_by_email(text, integer, text, uuid) IS
  'Removes up to _amount_cents (or the whole balance when null) of available wallet credit for an email by marking rows revoked. Never notifies the customer.';

GRANT EXECUTE ON FUNCTION public.revoke_customer_credit_by_email(text, integer, text, uuid) TO service_role;

-- Keep removed credit out of "lifetime granted" too. The customer wallet only
-- renders when lifetime_granted_cents > 0, so counting revoked rows would leave
-- a customer staring at an empty $0 wallet card after a quiet removal — the
-- opposite of not notifying them.
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
    'lifetime_granted_cents', COALESCE(SUM(CASE WHEN amount_cents > 0 AND status <> 'revoked' THEN amount_cents ELSE 0 END), 0),
    'lifetime_applied_cents', COALESCE(SUM(CASE WHEN status='applied' THEN amount_cents ELSE 0 END), 0),
    'open_count', COUNT(*) FILTER (WHERE status='available' AND (expires_at IS NULL OR expires_at > NOW()))
  )
  FROM cc;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_credit_balance(_customer_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'customer_id', _customer_id,
    'balance_cents', COALESCE(SUM(CASE WHEN status='available' AND (expires_at IS NULL OR expires_at > NOW()) THEN amount_cents ELSE 0 END), 0),
    'lifetime_granted_cents', COALESCE(SUM(CASE WHEN amount_cents > 0 AND status <> 'revoked' THEN amount_cents ELSE 0 END), 0),
    'lifetime_applied_cents', COALESCE(SUM(CASE WHEN status='applied' THEN amount_cents ELSE 0 END), 0),
    'open_count', COUNT(*) FILTER (WHERE status='available' AND (expires_at IS NULL OR expires_at > NOW()))
  )
  FROM public.customer_credits
  WHERE customer_id = _customer_id;
$function$;

NOTIFY pgrst, 'reload schema';
