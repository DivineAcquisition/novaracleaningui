-- ─── Lock the agreement-token minter to the service role ────────────────────
--
-- Applied to production separately from 20260729200000, which is why this is its
-- own file: that migration revoked EXECUTE from PUBLIC and granted it to
-- service_role, which reads like it is enough and isn't.
--
-- Supabase runs `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON
-- FUNCTIONS TO anon, authenticated, service_role`, so those two roles hold
-- EXECUTE *by name* the moment a function is created. `REVOKE ... FROM PUBLIC`
-- only drops the implicit world grant and leaves the named ones in place.
--
-- The consequence was live and confirmed against production: a plain POST to
-- /rest/v1/rpc/mint_cleaner_agreement_token carrying nothing but the anon key —
-- which ships inside the browser bundle — returned a valid 40-character signing
-- token for any contractor who hadn't signed. That token is the only credential
-- the signing page asks for, so anyone could have executed a contractor's
-- independent contractor agreement in their name.
--
-- Nothing legitimate loses access: cleaner-admin-action mints as the service
-- role, and no client-side code calls this RPC.

REVOKE ALL ON FUNCTION public.mint_cleaner_agreement_token(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint_cleaner_agreement_token(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.mint_cleaner_agreement_token(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mint_cleaner_agreement_token(uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
