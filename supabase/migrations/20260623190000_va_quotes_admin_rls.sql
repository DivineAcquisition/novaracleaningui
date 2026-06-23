-- Fix: internal booking "Save as quote" failed because public.va_quotes had
-- RLS enabled with ONLY a service_role policy. The internal booking workspace
-- saves quotes from the browser as the signed-in admin/VA (role
-- `authenticated`), so every INSERT was rejected by RLS.
--
-- Grant admins + VAs full access to va_quotes (mirrors the partner-portal
-- tables, which gate on public.is_admin_or_va(auth.uid())). Service-role
-- access is preserved by the existing policy.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'va_quotes'
      AND policyname = 'va_quotes_admin_va_all'
  ) THEN
    CREATE POLICY "va_quotes_admin_va_all" ON public.va_quotes
      FOR ALL TO authenticated
      USING (public.is_admin_or_va(auth.uid()))
      WITH CHECK (public.is_admin_or_va(auth.uid()));
  END IF;
END $$;
