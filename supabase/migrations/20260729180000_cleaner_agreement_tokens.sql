-- ─── Tokenized contractor agreement signing ─────────────────────────────────
--
-- We have active contractors who never signed an ICA. The only way to sign one
-- today is the five-step onboarding wizard behind a login — which is the wrong
-- ask for somebody who has been working for months and just needs to put their
-- name on a document. Every extra step is a place they drop out, and an unsigned
-- agreement is the one thing that blocks activation.
--
-- So: a single-purpose tokenized link. Open it, read the agreement, sign, done.
-- No account, no wizard, no dashboard. Same pattern as every other one-tap
-- contractor link we already send (job checklist, offer response, photo upload):
-- the unguessable token IS the credential, and it is single-use.
--
-- Reuses: cleaners (the flags activation already gates on), docuseal_submissions
-- (the signed PDF lands in the same place as a wizard signature), events.

ALTER TABLE public.cleaners
  -- 40 hex chars, minted per send. Cleared the moment it's used, so a
  -- forwarded text can't be replayed into a second submission.
  ADD COLUMN IF NOT EXISTS agreement_token text,
  ADD COLUMN IF NOT EXISTS agreement_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS agreement_token_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS agreement_token_sent_count integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS cleaners_agreement_token_uniq
  ON public.cleaners (agreement_token)
  WHERE agreement_token IS NOT NULL;

COMMENT ON COLUMN public.cleaners.agreement_token IS
  'Single-use credential for the tokenized ICA signing page (contractor.novaracleaning.com/cleaner/agreement/<token>). Cleared on signature so the link cannot be replayed. NULL = no outstanding signing link.';
COMMENT ON COLUMN public.cleaners.agreement_token_expires_at IS
  'When the outstanding signing link stops working. Short enough that a forwarded text goes stale, long enough that a contractor can sign at the weekend.';

/**
 * Mint (or re-mint) a signing link for a contractor who hasn't signed.
 *
 * Idempotent per send: calling it again replaces the token and extends the
 * window, so "resend" is always safe and the previous link dies. Returns NULL
 * when the cleaner has already signed — re-signing an executed agreement would
 * put a second contradictory document on the record.
 */
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
  IF v_signed IS NULL THEN RETURN NULL; END IF;
  IF v_signed THEN RETURN NULL; END IF;

  -- Schema-qualified: pgcrypto is installed in `extensions`, which this
  -- function's pinned search_path deliberately excludes.
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

-- Only the service role mints tokens (the admin edge function runs as it).
-- Supabase's default privileges grant EXECUTE on new public-schema functions to
-- anon and authenticated, and REVOKE ... FROM PUBLIC does NOT remove those, so
-- they have to be revoked by name. Without this, anyone holding the publicly
-- embedded anon key could mint a signing token for any unsigned contractor and
-- execute their agreement.
REVOKE ALL ON FUNCTION public.mint_cleaner_agreement_token(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint_cleaner_agreement_token(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.mint_cleaner_agreement_token(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mint_cleaner_agreement_token(uuid, integer) TO service_role;

-- Who still owes us a signature, and whether a link is out. The admin
-- directory reads this so "unsigned" is a worklist rather than a discovery.
CREATE OR REPLACE VIEW public.cleaner_agreement_status_v1 AS
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
  'Per-contractor ICA standing: signed or not, whether a signing link is outstanding, and whether they are ALREADY WORKING unsigned — the backlog the tokenized signing page exists to clear.';

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('cleaner.agreement_link_sent', 'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('cleaner.agreement_signed',    'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;
