-- Tokenized W-9 link. Admin and VA send it; the contractor opens
-- /cleaner/w9/<token> with no login. The token is the credential.

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS w9_token text,
  ADD COLUMN IF NOT EXISTS w9_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS w9_token_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS w9_token_sent_count integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS cleaners_w9_token_uniq
  ON public.cleaners (w9_token)
  WHERE w9_token IS NOT NULL;

COMMENT ON COLUMN public.cleaners.w9_token IS
  'Secret for the no-login W-9 page. Re-minted each time admin or VA sends the link.';

CREATE OR REPLACE FUNCTION public.mint_cleaner_w9_token(
  p_cleaner_id uuid,
  p_ttl_days integer DEFAULT 14
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cleaners WHERE id = p_cleaner_id) THEN
    RETURN NULL;
  END IF;

  v_token := encode(extensions.gen_random_bytes(20), 'hex');

  UPDATE public.cleaners
    SET w9_token = v_token,
        w9_token_expires_at = now() + (GREATEST(1, COALESCE(p_ttl_days, 14)) || ' days')::interval,
        w9_token_sent_at = now(),
        w9_token_sent_count = COALESCE(w9_token_sent_count, 0) + 1,
        updated_at = now()
    WHERE id = p_cleaner_id;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.mint_cleaner_w9_token(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint_cleaner_w9_token(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.mint_cleaner_w9_token(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mint_cleaner_w9_token(uuid, integer) TO service_role;

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('cleaner.w9_link_sent', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('cleaner.w9_submitted', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

NOTIFY pgrst, 'reload schema';
