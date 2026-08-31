-- ─── Tokenized contractor onboarding invites ────────────────────────────────
--
-- When Talent launches / resends onboarding, each invite gets a unique token.
-- The emailed/SMS link points at contractor.novaracleaning.com/cleaner/auth
-- ?invite=<token> — normal onboarding after sign-in, skipping the /cleaner/role
-- intro video. Tokens expire after 14 days; resend mints a fresh one.

ALTER TABLE public.cleaner_applicants
  ADD COLUMN IF NOT EXISTS invite_token text,
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS cleaner_applicants_invite_token_uniq
  ON public.cleaner_applicants (invite_token)
  WHERE invite_token IS NOT NULL;

NOTIFY pgrst, 'reload schema';
