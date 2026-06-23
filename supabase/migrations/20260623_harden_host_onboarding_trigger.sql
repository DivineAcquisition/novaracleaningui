-- ─── Harden host onboarding trigger fn search_path ───────────────────────
--
-- The updated_at touch trigger was created with a role-mutable search_path
-- (Supabase linter 0011). Pin it so the function always resolves objects
-- against a fixed schema list regardless of the caller's search_path.

alter function public.touch_host_onboarding_updated_at() set search_path = pg_catalog, public;
