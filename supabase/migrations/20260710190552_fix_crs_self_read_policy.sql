-- ─── Fix: admin recurring-schedule writes failed with "[object Object]" ─────
--
-- crs_self_read (customer self-service SELECT policy) ran a subquery on
-- auth.users, which the `authenticated` role cannot read → every admin
-- insert/update with RETURNING (and every client-side read) failed with
-- "permission denied for table users". The admin UI rendered the raw
-- PostgrestError as "[object Object]".
--
-- SELECT policies are OR'd, so this broke reads even for admins that pass
-- crs_admin_all. Use the JWT email claim instead — no table access needed.
-- (Applied live 2026-07-10.)

DROP POLICY IF EXISTS crs_self_read ON public.customer_recurring_schedules;
CREATE POLICY crs_self_read ON public.customer_recurring_schedules
  FOR SELECT TO authenticated
  USING (email = coalesce(auth.jwt() ->> 'email', ''));
