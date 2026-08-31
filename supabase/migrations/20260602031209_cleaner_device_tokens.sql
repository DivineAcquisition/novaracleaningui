-- Device push tokens for the contractor mobile app (Novara Pro).
-- The app registers an APNs/FCM token on launch; the backend uses these
-- to push job offers / assignment alerts to a specific cleaner's devices.

CREATE TABLE IF NOT EXISTS public.cleaner_device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  platform text NOT NULL DEFAULT 'unknown' CHECK (platform IN ('ios','android','web','unknown')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleaner_device_tokens_cleaner ON public.cleaner_device_tokens(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_cleaner_device_tokens_user ON public.cleaner_device_tokens(user_id);

ALTER TABLE public.cleaner_device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device tokens owner rw" ON public.cleaner_device_tokens;
CREATE POLICY "device tokens owner rw" ON public.cleaner_device_tokens
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
