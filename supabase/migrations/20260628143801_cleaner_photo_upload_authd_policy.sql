-- ─── Cleaner photo-upload: allow AUTHENTICATED uploads too ────────────────
--
-- The /cleaner/job-photos/[token] page uploads before/after photos straight
-- to the public `cleaner-job-photos` bucket using the shared browser Supabase
-- client. That client has `persistSession: true`, so a cleaner who is already
-- logged into the app (the common case — they reach the SMS link on the same
-- phone where the cleaner dashboard / mobile app is signed in) sends their
-- `authenticated` JWT with the upload request.
--
-- The original 20260530 migration only created an INSERT policy for the
-- `anon` role, so every authenticated upload was silently rejected by RLS —
-- which is why no before/after photos ever landed in the bucket. The turnover
-- flow already hit this exact problem and added a matching authenticated
-- policy; this migration brings cleaner-job-photos in line.

DO $$
BEGIN
  -- INSERT for authenticated cleaners (logged-in app session).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='cleaner_job_photos_authd_upload'
  ) THEN
    CREATE POLICY "cleaner_job_photos_authd_upload"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'cleaner-job-photos');
  END IF;

  -- SELECT for authenticated cleaners (the client also reads back the object
  -- via getPublicUrl; the bucket is public so this is belt-and-suspenders).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='cleaner_job_photos_authd_read'
  ) THEN
    CREATE POLICY "cleaner_job_photos_authd_read"
      ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'cleaner-job-photos');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
