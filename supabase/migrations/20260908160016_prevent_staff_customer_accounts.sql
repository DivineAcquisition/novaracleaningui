-- Admins and VAs cannot hold customer portal accounts.
-- True when the email is the Novara work domain, has an admin/VA role,
-- or belongs to an approved VA onboarding row.

CREATE OR REPLACE FUNCTION public.is_staff_customer_email(_email text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
DECLARE
  norm text;
BEGIN
  norm := lower(trim(coalesce(_email, '')));
  IF norm = '' OR position('@' in norm) = 0 THEN
    RETURN false;
  END IF;

  IF norm LIKE '%@novaracleaning.com' THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
    WHERE lower(u.email) = norm
      AND ur.role IN ('admin'::public.app_role, 'va'::public.app_role)
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.va_onboarding vo
    WHERE vo.status = 'approved'
      AND lower(vo.email) = norm
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_staff_customer_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff_customer_email(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff_customer_email(text) TO postgres, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_staff_customer_accounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF public.is_staff_customer_email(NEW.email) THEN
    RAISE EXCEPTION 'Staff (admin/VA) emails cannot have customer accounts'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_staff_customer_accounts ON public.customers;
CREATE TRIGGER trg_prevent_staff_customer_accounts
  BEFORE INSERT OR UPDATE OF email ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_staff_customer_accounts();

-- Drop unused staff customer rows (no bookings). Null jobs first (NO ACTION FK).
-- bookings.customer_id is text (sometimes a Stripe cus_ id); jobs.customer_id is uuid.
UPDATE public.jobs
SET customer_id = NULL
WHERE customer_id IN (
  SELECT c.id
  FROM public.customers c
  WHERE public.is_staff_customer_email(c.email)
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.customer_id = c.id::text OR lower(b.email) = lower(c.email)
    )
);

DELETE FROM public.customers c
WHERE public.is_staff_customer_email(c.email)
  AND NOT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.customer_id = c.id::text OR lower(b.email) = lower(c.email)
  );
