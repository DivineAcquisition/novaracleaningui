-- Hosted check: inserting a staff email into public.customers must fail.
DO $$
DECLARE
  caught boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.customers (email, first_name) VALUES ('mason@novaracleaning.com', 'Mason');
  EXCEPTION
    WHEN others THEN
      IF SQLERRM LIKE 'Staff (admin/VA)%' THEN
        caught := true;
      ELSE
        RAISE;
      END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'expected staff customer insert to be blocked';
  END IF;
END $$;
