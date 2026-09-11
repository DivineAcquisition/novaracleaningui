-- ─── Contractor Standards & Conduct Addendum acknowledgments ────────────────
--
-- The addendum clarifies the professional standard already required under the
-- ICA: appearance, phone reachability, working the checklist, client property,
-- pets, punctuality, chemicals, and self-reporting incidents. Every contractor
-- acknowledges it — existing contractors re-acknowledge, new contractors
-- acknowledge at onboarding.
--
-- The ICA is a contract, signed once, and its schema says so: ob_agreement_signed
-- is a boolean and mint_cleaner_agreement_token refuses outright once it's true.
-- That shape is wrong for this. The addendum will be revised as new failure modes
-- turn up, and each revision has to be consented to again by people who already
-- agreed to the previous one. So the record here is a VERSION, not a flag, and
-- "acknowledged" only ever means "acknowledged THIS version".
--
-- Two places hold state, deliberately:
--   * cleaner_conduct_acknowledgments — append-only. One row per acknowledgment,
--     keeping the version, the wording consented to, and the signature. This is
--     the evidence: when an incident is reviewed months later, the question is
--     what they agreed to at the time, and an overwritten row cannot answer it.
--   * cleaners.conduct_standards_version / _acknowledged_at — the latest
--     acknowledgment, denormalized so gating a dispatch or rendering a directory
--     row is one column read, the same way ob_agreement_signed works.
--
-- The addendum text itself lives in src/lib/contractor-standards.ts. Only the
-- current version string is mirrored here, for the edge function that sends
-- links and the status view below; `npm run standards:verify` fails if the two
-- disagree.

-- ── Current version ─────────────────────────────────────────────────────────
-- Bump in the same change that bumps CONTRACTOR_STANDARDS_VERSION in
-- src/lib/contractor-standards.ts. Everyone on an older version is then owed a
-- fresh acknowledgment, and the admin panel starts listing them automatically.
INSERT INTO public.app_settings (key, value, description) VALUES (
  'contractor_standards',
  jsonb_build_object(
    'version', '2026-09-11',
    'edition', 'Edition 1.0 · September 2026',
    'link_ttl_days', 30
  ),
  'Current Contractor Standards & Conduct Addendum version. MIRROR of CONTRACTOR_STANDARDS_VERSION in src/lib/contractor-standards.ts — bump both together; npm run standards:verify enforces it.'
)
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = now();

-- ── Latest acknowledgment, denormalized onto the contractor ─────────────────
ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS conduct_standards_version text,
  ADD COLUMN IF NOT EXISTS conduct_standards_acknowledged_at timestamptz,
  -- 40 hex chars, minted per send. NOT burned on use: unlike the ICA link, this
  -- one is worth re-opening — a contractor who wants to re-read the pet rules
  -- mid-job should not hit a dead link. Replay is harmless because a second
  -- acknowledgment of the same version is idempotent.
  ADD COLUMN IF NOT EXISTS conduct_standards_token text,
  ADD COLUMN IF NOT EXISTS conduct_standards_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS conduct_standards_token_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS conduct_standards_token_sent_count integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS cleaners_conduct_standards_token_uniq
  ON public.cleaners (conduct_standards_token)
  WHERE conduct_standards_token IS NOT NULL;

COMMENT ON COLUMN public.cleaners.conduct_standards_version IS
  'Version of the Contractor Standards & Conduct Addendum this contractor last acknowledged. NULL = never acknowledged. Anything other than the current version means a re-acknowledgment is owed — compare, do not treat as a boolean.';
COMMENT ON COLUMN public.cleaners.conduct_standards_acknowledged_at IS
  'When conduct_standards_version was acknowledged. Denormalized from the newest cleaner_conduct_acknowledgments row.';
COMMENT ON COLUMN public.cleaners.conduct_standards_token IS
  'Credential for the acknowledgment page (contractor.novaracleaning.com/cleaner/standards/<token>). Replaced on resend; NOT burned on acknowledgment, so the standards stay readable from the same text message.';

-- ── The evidence: append-only, one row per acknowledgment ───────────────────
CREATE TABLE IF NOT EXISTS public.cleaner_conduct_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  version text NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  -- Where the acknowledgment came from. 'onboarding' is a new contractor at
  -- signup; 'standards_link' is the texted re-acknowledgment link.
  source text NOT NULL DEFAULT 'standards_link'
    CHECK (source IN ('onboarding', 'standards_link', 'admin')),
  -- Typed legal name + drawn signature, as on the paper acknowledgment block.
  legal_name text,
  signature_data_url text,
  -- The consent wording as it stood at acknowledgment time. Copied rather than
  -- referenced: the whole point of keeping old rows is being able to read back
  -- what someone agreed to, and a pointer into current code cannot do that
  -- once the current code has changed.
  acknowledgment_text text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per contractor per version. A double-tap, a refreshed page, or a
-- re-opened text cannot manufacture a second record of the same consent; the
-- application upserts on this and treats the repeat as success.
CREATE UNIQUE INDEX IF NOT EXISTS cleaner_conduct_ack_cleaner_version_uniq
  ON public.cleaner_conduct_acknowledgments (cleaner_id, version);

CREATE INDEX IF NOT EXISTS cleaner_conduct_ack_cleaner_idx
  ON public.cleaner_conduct_acknowledgments (cleaner_id, acknowledged_at DESC);

COMMENT ON TABLE public.cleaner_conduct_acknowledgments IS
  'Append-only record of every Contractor Standards & Conduct Addendum acknowledgment: which version, when, how, and the wording consented to. Never updated in place — a superseded acknowledgment is still the answer to "what had they agreed to on the day of the incident?".';

ALTER TABLE public.cleaner_conduct_acknowledgments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Admins and VAs read the ledger from the directory; nobody edits it by hand.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cleaner_conduct_acknowledgments'
      AND policyname = 'cleaner_conduct_ack_admin_read'
  ) THEN
    CREATE POLICY cleaner_conduct_ack_admin_read
      ON public.cleaner_conduct_acknowledgments FOR SELECT TO authenticated
      USING (public.is_admin_or_va(auth.uid()));
  END IF;

  -- A contractor can see their own acknowledgments (the profile shows them
  -- what they signed and when), but cannot write one: acknowledgments are
  -- created by the API routes running as the service role, which is what
  -- stamps the version and the wording consistently.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cleaner_conduct_acknowledgments'
      AND policyname = 'cleaner_conduct_ack_own_read'
  ) THEN
    CREATE POLICY cleaner_conduct_ack_own_read
      ON public.cleaner_conduct_acknowledgments FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.cleaners c
        WHERE c.id = cleaner_conduct_acknowledgments.cleaner_id
          AND c.user_id = auth.uid()
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cleaner_conduct_acknowledgments'
      AND policyname = 'cleaner_conduct_ack_service_all'
  ) THEN
    CREATE POLICY cleaner_conduct_ack_service_all
      ON public.cleaner_conduct_acknowledgments FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END$$;

-- ── Minting an acknowledgment link ──────────────────────────────────────────
/**
 * Mint (or re-mint) an acknowledgment link for a contractor.
 *
 * The one meaningful difference from mint_cleaner_agreement_token: having
 * acknowledged an EARLIER version does not block a link. That is the whole
 * re-acknowledgment path. It returns NULL only when there is genuinely nothing
 * to ask for — they have already acknowledged the current version — so a
 * mis-tap on an up-to-date contractor can't text them a pointless link.
 *
 * The version is read from app_settings rather than passed in, so a caller
 * cannot invent a version string and put the whole roster into a false
 * "re-acknowledgment owed" state.
 */
CREATE OR REPLACE FUNCTION public.mint_cleaner_standards_token(
  p_cleaner_id uuid,
  p_ttl_days integer DEFAULT 30
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current text;
  v_acknowledged text;
  v_token text;
BEGIN
  SELECT value->>'version' INTO v_current
  FROM public.app_settings WHERE key = 'contractor_standards';
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'app_settings.contractor_standards.version is not set';
  END IF;

  SELECT conduct_standards_version INTO v_acknowledged
  FROM public.cleaners WHERE id = p_cleaner_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_acknowledged IS NOT DISTINCT FROM v_current THEN RETURN NULL; END IF;

  -- Schema-qualified: pgcrypto lives in `extensions`, which this function's
  -- pinned search_path deliberately excludes.
  v_token := encode(extensions.gen_random_bytes(20), 'hex');

  UPDATE public.cleaners
    SET conduct_standards_token = v_token,
        conduct_standards_token_expires_at =
          now() + (GREATEST(1, COALESCE(p_ttl_days, 30)) || ' days')::interval,
        conduct_standards_token_sent_at = now(),
        conduct_standards_token_sent_count =
          COALESCE(conduct_standards_token_sent_count, 0) + 1,
        updated_at = now()
    WHERE id = p_cleaner_id;

  RETURN v_token;
END;
$$;

-- Only the service role mints tokens (the admin edge function runs as it).
-- Supabase grants EXECUTE on new public functions to anon and authenticated by
-- default, and REVOKE ... FROM PUBLIC does not remove those, so they have to go
-- by name — otherwise the publicly embedded anon key can mint an acknowledgment
-- link for any contractor and acknowledge the standards on their behalf.
REVOKE ALL ON FUNCTION public.mint_cleaner_standards_token(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mint_cleaner_standards_token(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.mint_cleaner_standards_token(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mint_cleaner_standards_token(uuid, integer) TO service_role;

-- ── Who still owes an acknowledgment ────────────────────────────────────────
-- The admin panel reads this so the re-acknowledgment campaign is a worklist
-- rather than a spreadsheet exercise. `standing` is computed against
-- app_settings, so publishing a revision repopulates it with no code change.
--
-- The current version is pulled in as a scalar subquery rather than joined:
-- a CROSS JOIN would collapse the whole view to zero rows if the settings row
-- ever went missing, and the admin panel reads an empty result as "everybody is
-- current" — the most expensive possible wrong answer. This way a missing
-- setting makes everyone read as owing an acknowledgment, which is the same
-- direction standardsStanding() fails in.
CREATE OR REPLACE VIEW public.cleaner_conduct_standards_status_v1 AS
WITH current_standards AS (
  SELECT value->>'version' AS version
  FROM public.app_settings
  WHERE key = 'contractor_standards'
)
SELECT
  c.id                                          AS cleaner_id,
  TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS cleaner_name,
  c.email,
  c.phone,
  c.status,
  c.approved,
  (SELECT version FROM current_standards)       AS current_version,
  c.conduct_standards_version                   AS acknowledged_version,
  c.conduct_standards_acknowledged_at           AS acknowledged_at,
  CASE
    WHEN c.conduct_standards_version IS NULL THEN 'never'
    WHEN c.conduct_standards_version = (SELECT version FROM current_standards) THEN 'current'
    ELSE 'outdated'
  END                                           AS standing,
  c.conduct_standards_token IS NOT NULL
    AND (c.conduct_standards_token_expires_at IS NULL
      OR c.conduct_standards_token_expires_at > now())
                                                AS link_outstanding,
  c.conduct_standards_token_sent_at,
  c.conduct_standards_token_expires_at,
  COALESCE(c.conduct_standards_token_sent_count, 0) AS link_sent_count,
  -- An active, approved contractor going into clients' homes without having
  -- acknowledged the current standards. This is the row that matters: the
  -- standards exist to be enforceable, and enforcing one nobody acknowledged
  -- is the situation the addendum was written to end.
  (c.status = 'active'
    AND COALESCE(c.approved, false)
    AND c.conduct_standards_version IS DISTINCT FROM (SELECT version FROM current_standards))
                                                AS working_unacknowledged
FROM public.cleaners c
WHERE c.status <> 'terminated';

COMMENT ON VIEW public.cleaner_conduct_standards_status_v1 IS
  'Per-contractor standing against the CURRENT Contractor Standards & Conduct Addendum: never acknowledged, acknowledged an older version, or current — plus whether an acknowledgment link is outstanding. Publishing a revision (bumping app_settings.contractor_standards.version) refills this automatically.';

INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('cleaner.standards_link_sent',   'DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('cleaner.standards_acknowledged','DISCORD_WEBHOOK_DISPATCH', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;
