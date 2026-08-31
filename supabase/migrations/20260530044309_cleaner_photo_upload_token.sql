-- ─── Cleaner photo-upload token ────────────────────────────────────────
-- Adds a per-booking token + sent timestamp the new completion SMS uses
-- to send cleaners a public photo-upload form. The token lives ONLY on
-- the booking row (one cleaner, one job) — no need for a separate
-- table.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS photo_upload_token   text,
  ADD COLUMN IF NOT EXISTS photo_upload_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS photo_upload_submitted_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_photo_upload_token_unique
  ON public.bookings (photo_upload_token)
  WHERE photo_upload_token IS NOT NULL;

-- Storage bucket for the photos. Public read so the GHL contact page
-- + admin Bookings sheet can display them inline.
INSERT INTO storage.buckets (id, name, public, avif_autodetection)
VALUES ('cleaner-job-photos', 'cleaner-job-photos', true, false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='cleaner_job_photos_service_role'
  ) THEN
    CREATE POLICY "cleaner_job_photos_service_role"
      ON storage.objects FOR ALL TO service_role
      USING (bucket_id = 'cleaner-job-photos')
      WITH CHECK (bucket_id = 'cleaner-job-photos');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='cleaner_job_photos_anon_upload'
  ) THEN
    CREATE POLICY "cleaner_job_photos_anon_upload"
      ON storage.objects FOR INSERT TO anon
      WITH CHECK (bucket_id = 'cleaner-job-photos');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='cleaner_job_photos_public_read'
  ) THEN
    CREATE POLICY "cleaner_job_photos_public_read"
      ON storage.objects FOR SELECT TO anon
      USING (bucket_id = 'cleaner-job-photos');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
