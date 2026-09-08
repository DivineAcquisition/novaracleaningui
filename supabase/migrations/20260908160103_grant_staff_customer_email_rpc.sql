-- Hosted follow-up: execute_sql / extra roles need EXECUTE on the RPC.
GRANT EXECUTE ON FUNCTION public.is_staff_customer_email(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff_customer_email(text) TO postgres, anon, authenticated, service_role;
