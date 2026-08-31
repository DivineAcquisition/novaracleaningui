-- ─── Talent acquisition sync + cleaner hub applicant pipeline ─────────────────
--
-- Applicants flow Fillout → Airtable ("NVC | Client & Revenue Ops" base
-- appoUuFQZQfCyKGlw, Applicants table) and are pulled ONE-WAY into the admin
-- workspace, which is
-- the system of record from that point on. This migration adds:
--
--   1. public.cleaner_applicants — the Applicants queue behind the cleaner hub.
--      Upserted by Airtable record id, deduped by email (fallback phone) so a
--      re-application updates the same person, never duplicates them.
--   2. RLS: admin/VA manage, service-role full (sync + actions run server-side).
--   3. Discord notification route for new applicants (existing events channel).
--   4. pg_cron job: poll the talent base every 10 minutes via the Next.js
--      sync route (same pattern as reconcile-contractors-every-6h).

CREATE TABLE IF NOT EXISTS public.cleaner_applicants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity / dedupe
  airtable_record_id text NOT NULL UNIQUE,
  email text,
  phone text,
  full_name text,
  first_name text,
  last_name text,

  -- Submission details (whatever the Fillout form captured)
  address text,
  zip_code text,
  state text,
  zone text,
  role text,
  department text,
  contractor_type text,
  experience text,
  availability text,
  preferred_days text[] DEFAULT '{}',
  transportation text,
  authorized_to_work text,
  consent_1099 boolean,
  background_check_consent boolean,
  pay_consent boolean,
  reliability_note text,
  reason_note text,
  submission jsonb NOT NULL DEFAULT '{}'::jsonb, -- full raw Airtable fields snapshot

  -- Pipeline (progression happens HERE, never in Airtable)
  stage text NOT NULL DEFAULT 'applicant'
    CHECK (stage IN ('applicant','screening','onboarding','agreement_signed','active','rejected','withdrawn')),
  rejection_reason text,
  stage_changed_at timestamptz,
  stage_changed_by text,

  -- Onboarding launch tracking
  cleaner_id uuid REFERENCES public.cleaners(id) ON DELETE SET NULL,
  onboarding_launched_at timestamptz,
  onboarding_last_nudge_at timestamptz,

  -- Sync bookkeeping
  airtable_marked_imported boolean NOT NULL DEFAULT false,
  applied_at timestamptz,
  airtable_last_modified timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Dedupe lookups: match by email first, phone second.
CREATE INDEX IF NOT EXISTS idx_cleaner_applicants_email ON public.cleaner_applicants (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cleaner_applicants_phone ON public.cleaner_applicants (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cleaner_applicants_stage ON public.cleaner_applicants (stage);

ALTER TABLE public.cleaner_applicants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admin/VA manage applicants" ON public.cleaner_applicants
    FOR ALL USING (public.is_admin_or_va(auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_full_access" ON public.cleaner_applicants
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION public.touch_cleaner_applicants_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_touch_cleaner_applicants ON public.cleaner_applicants;
CREATE TRIGGER trg_touch_cleaner_applicants
BEFORE UPDATE ON public.cleaner_applicants
FOR EACH ROW EXECUTE FUNCTION public.touch_cleaner_applicants_updated_at();

-- ─── Admin notification: new applicants ride the existing events → Discord path
INSERT INTO public.discord_routes (event_type, webhook_key, role_keys, enabled)
VALUES ('applicant.created', 'DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS'], true)
ON CONFLICT (event_type) DO NOTHING;

-- ─── Secrets + cron: poll Airtable every 10 minutes ───────────────────────────
INSERT INTO public.app_secrets (key, value, description)
VALUES
  ('TALENT_SYNC_URL', 'https://try.novaracleaning.com/api/talent/sync',
   'Next.js route that pulls talent-acquisition applicants from Airtable into cleaner_applicants.'),
  ('TALENT_SYNC_SECRET', encode(gen_random_bytes(24), 'hex'),
   'Shared secret for the talent sync route (query ?secret= or x-talent-secret header).')
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  PERFORM cron.unschedule('talent-sync-every-10min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'talent-sync-every-10min',
  '*/10 * * * *',
  $CRON$
    select net.http_post(
      url := (select value from public.app_secrets where key='TALENT_SYNC_URL') || '?secret=' || (select value from public.app_secrets where key='TALENT_SYNC_SECRET'),
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type','application/json'),
      timeout_milliseconds := 120000
    );
  $CRON$
);
