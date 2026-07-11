-- ─── VA offer letters: tokenized, 30-minute invite links ────────────────────
--
-- VA onboarding becomes invite-driven: an admin sends an OFFER LETTER email
-- from the Teams tab; the tokenized link expires 30 minutes after being sent
-- (re-sendable, which mints a fresh token/window). The token carries the VA's
-- identity, so the wizard can put the AGREEMENT step first.

ALTER TABLE public.va_onboarding
  ADD COLUMN IF NOT EXISTS invite_token text,
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_by uuid,
  ADD COLUMN IF NOT EXISTS offer_note text;

CREATE UNIQUE INDEX IF NOT EXISTS va_onboarding_invite_token_uniq
  ON public.va_onboarding (invite_token)
  WHERE invite_token IS NOT NULL;

NOTIFY pgrst, 'reload schema';
