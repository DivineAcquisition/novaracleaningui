-- No-login link for the expectation-video training page.
-- The token is the credential. It does not belong to a contractor and
-- does not stamp training progress.

CREATE TABLE IF NOT EXISTS public.training_watch_tokens (
  token text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.training_watch_tokens IS
  'Secret for /cleaner/training/watch/<token>. Opens the expectation video with no contractor login.';

ALTER TABLE public.training_watch_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.training_watch_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.training_watch_tokens FROM anon;
REVOKE ALL ON TABLE public.training_watch_tokens FROM authenticated;

NOTIFY pgrst, 'reload schema';
