-- ─── Guarantee every job assignment has a response_token ───────────────────
--
-- The response_token powers every tokenized contractor link (offer page,
-- job checklist). Auto-dispatch mints one, but manual admin assignments and
-- some legacy paths historically inserted rows with NULL tokens — breaking
-- those links. This trigger mints a token on INSERT whenever it's missing,
-- so no code path can ever create a token-less assignment again, and
-- backfills the existing active rows.

CREATE OR REPLACE FUNCTION public.ensure_assignment_response_token()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.response_token IS NULL OR length(btrim(NEW.response_token)) = 0 THEN
    NEW.response_token := md5(gen_random_uuid()::text || clock_timestamp()::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_response_token ON public.job_assignments;
CREATE TRIGGER trg_assignment_response_token
  BEFORE INSERT ON public.job_assignments
  FOR EACH ROW EXECUTE FUNCTION public.ensure_assignment_response_token();

-- Backfill: active/complete-ish assignments missing a token.
UPDATE public.job_assignments
  SET response_token = md5(gen_random_uuid()::text || clock_timestamp()::text)
  WHERE response_token IS NULL;
