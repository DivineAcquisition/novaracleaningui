-- ─── Cleaner termination workflow ───────────────────────────────────────────
--
-- A complete, auditable off-boarding flow for contractors:
--   • a structured termination reason (one of 7 core reasons + other)
--   • an internal rehire label so the directory knows whether an ex-contractor
--     is rehireable / no-hire / under review / blacklisted
--   • a termination letter emailed to the contractor with HR cc'd
--   • a full audit row per termination
--
-- The rehire label powers "is this applicant hireable?" checks down the line.

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS rehire_status text
    CHECK (rehire_status IS NULL OR rehire_status IN ('rehireable','no_rehire','under_review','blacklist')),
  ADD COLUMN IF NOT EXISTS rehire_notes text,
  ADD COLUMN IF NOT EXISTS termination_effective_date date,
  ADD COLUMN IF NOT EXISTS termination_letter_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS terminated_by uuid;

CREATE INDEX IF NOT EXISTS cleaners_rehire_status_idx ON public.cleaners (rehire_status);

-- ─── Termination audit log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cleaner_terminations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  reason text NOT NULL,                 -- machine code (one of the 7 core + other)
  reason_label text,                    -- human label snapshot
  rehire_status text NOT NULL DEFAULT 'no_rehire'
    CHECK (rehire_status IN ('rehireable','no_rehire','under_review','blacklist')),
  notes text,
  effective_date date,
  letter_to text,                       -- contractor email the letter went to
  letter_cc text,                       -- HR cc
  letter_sent boolean NOT NULL DEFAULT false,
  letter_error text,
  terminated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cleaner_terminations_cleaner_idx ON public.cleaner_terminations (cleaner_id, created_at DESC);

ALTER TABLE public.cleaner_terminations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cleaner_terminations' AND policyname='cleaner_terminations_admin_read') THEN
    CREATE POLICY "cleaner_terminations_admin_read" ON public.cleaner_terminations
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','va')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cleaner_terminations' AND policyname='cleaner_terminations_service_role') THEN
    CREATE POLICY "cleaner_terminations_service_role" ON public.cleaner_terminations
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
