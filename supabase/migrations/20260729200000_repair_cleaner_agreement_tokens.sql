-- ─── Repair: tokenized contractor agreement signing ─────────────────────────
--
-- 20260729180000_cleaner_agreement_tokens.sql only landed halfway in
-- production. The three token columns and the unique index are there, but
-- `agreement_token_sent_count`, `mint_cleaner_agreement_token()` and
-- `cleaner_agreement_status_v1` never got created — so every "send agreement
-- link" click died on the missing RPC before a token was ever minted, and the
-- unsigned-contractor panel silently rendered nothing because its view was
-- absent.
--
-- The minting function was also wrong where it did exist: pgcrypto lives in the
-- `extensions` schema here, so an unqualified gen_random_bytes() is invisible to
-- a SECURITY DEFINER function pinned to `search_path = public, pg_temp`. It is
-- schema-qualified below rather than widening the search path, which keeps a
-- definer-rights function from resolving names through a caller-influenced path.
--
-- Everything here is written to converge from either state: the halfway one in
-- production, or a clean database that already ran the original migration.

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS agreement_token text,
  ADD COLUMN IF NOT EXISTS agreement_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS agreement_token_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS agreement_token_sent_count integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS cleaners_agreement_token_uniq
  ON public.cleaners (agreement_token)
  WHERE agreement_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mint_cleaner_agreement_token(
  p_cleaner_id uuid,
  p_ttl_days integer DEFAULT 30
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_signed boolean;
  v_token text;
BEGIN
  SELECT COALESCE(ob_agreement_signed, false) INTO v_signed
  FROM public.cleaners WHERE id = p_cleaner_id;
  -- No row at all: NOT FOUND rather than a NULL signed flag, since the
  -- COALESCE above means a real row can never yield NULL here.
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_signed THEN RETURN NULL; END IF;

  v_token := encode(extensions.gen_random_bytes(20), 'hex');

  UPDATE public.cleaners
    SET agreement_token = v_token,
        agreement_token_expires_at = now() + (GREATEST(1, COALESCE(p_ttl_days, 30)) || ' days')::interval,
        agreement_token_sent_at = now(),
        agreement_token_sent_count = COALESCE(agreement_token_sent_count, 0) + 1,
        updated_at = now()
    WHERE id = p_cleaner_id;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.mint_cleaner_agreement_token(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mint_cleaner_agreement_token(uuid, integer) TO service_role;

-- Who still owes us a signature, and whether a link is out. The admin
-- directory reads this so "unsigned" is a worklist rather than a discovery.
DROP VIEW IF EXISTS public.cleaner_agreement_status_v1;

CREATE VIEW public.cleaner_agreement_status_v1
-- Contractor names, emails and phones. Without security_invoker the view would
-- run as its owner and hand the whole roster to anyone holding the anon key,
-- because Supabase grants public-schema tables to anon by default. Invoker
-- rights mean the existing admin/VA policies on `cleaners` decide instead.
WITH (security_invoker = true) AS
SELECT
  c.id                                        AS cleaner_id,
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS cleaner_name,
  c.email,
  c.phone,
  c.status,
  c.approved,
  COALESCE(c.ob_agreement_signed, false)      AS signed,
  c.ob_agreement_signed_at                    AS signed_at,
  c.agreement_token IS NOT NULL
    AND (c.agreement_token_expires_at IS NULL OR c.agreement_token_expires_at > now())
                                              AS link_outstanding,
  c.agreement_token_sent_at,
  c.agreement_token_expires_at,
  COALESCE(c.agreement_token_sent_count, 0)   AS link_sent_count,
  -- An active, approved contractor with no signed agreement is the case this
  -- exists for: they are already taking work on a handshake.
  (COALESCE(c.ob_agreement_signed, false) = false
    AND c.status = 'active'
    AND COALESCE(c.approved, false))          AS working_unsigned,
  -- docuseal_submissions.cleaner_id is untyped and historically holds the AUTH
  -- user id for wizard signatures and the cleaners.id for tokenized ones, so
  -- match either rather than silently showing no document.
  (SELECT s.document_url FROM public.docuseal_submissions s
    WHERE s.audience = 'contractor'
      AND s.cleaner_id IN (c.id, c.user_id)
      AND s.document_url IS NOT NULL
    ORDER BY s.created_at DESC LIMIT 1)       AS document_url
FROM public.cleaners c
WHERE c.status <> 'terminated';

COMMENT ON VIEW public.cleaner_agreement_status_v1 IS
  'Per-contractor ICA standing: signed or not, whether a signing link is outstanding, and whether they are ALREADY WORKING unsigned — the backlog the tokenized signing page exists to clear. security_invoker, so the caller''s own access to public.cleaners applies.';

REVOKE ALL ON public.cleaner_agreement_status_v1 FROM anon;
GRANT SELECT ON public.cleaner_agreement_status_v1 TO authenticated, service_role;

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('cleaner.agreement_link_sent', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('cleaner.agreement_signed',    'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;
