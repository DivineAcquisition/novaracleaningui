-- ─── Stop anon from spending or wiping a customer's credit ─────────────────
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, so writing only
-- `GRANT EXECUTE ... TO service_role` adds a grant without removing the
-- implicit one. Both email-keyed credit writers shipped that way and were
-- reachable with nothing but the anon key and a guessed email address:
--
--   revoke_customer_credit_by_email       wipe any customer's wallet
--   apply_customer_credit_to_booking_by_email
--                                         burn a customer's wallet against
--                                         an arbitrary booking id
--
-- Both are SECURITY DEFINER, so PostgREST happily ran them as the owner. The
-- by-id twins (grant_customer_credit, apply_customer_credit_to_booking) were
-- already locked to service_role; this brings the by-email pair in line.
--
-- The two read-only balance functions keep their anon grant on purpose — the
-- checkout page and the customer wallet call them with the browser's key.

REVOKE ALL ON FUNCTION public.revoke_customer_credit_by_email(text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_customer_credit_by_email(text, integer, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.apply_customer_credit_to_booking_by_email(text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_customer_credit_to_booking_by_email(text, uuid, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
