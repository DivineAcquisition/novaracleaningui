-- Form 1099-NEC (Rev. December 2026).
-- Copy B and Copy C are retained on the filing row. Copy A is the e-file
-- jsonb and is not a PDF. Filed rows are immutable; a correction is a new
-- row linked to the original.

CREATE TABLE IF NOT EXISTS public.cleaner_w9 (
  cleaner_id uuid PRIMARY KEY REFERENCES public.cleaners(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  tin text NOT NULL,
  tin_type text NOT NULL CHECK (tin_type IN ('ssn', 'ein', 'itin')),
  street text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  zip text NOT NULL,
  validated_at timestamptz,
  validated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cleaner_w9 IS
  'Validated W-9 identity used as the 1099 recipient. The form reads this row and does not accept a retyped name, address, or TIN.';

ALTER TABLE public.cleaner_w9 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cleaner_w9_admin ON public.cleaner_w9;
CREATE POLICY cleaner_w9_admin ON public.cleaner_w9
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS cleaner_w9_service ON public.cleaner_w9;
CREATE POLICY cleaner_w9_service ON public.cleaner_w9
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.cleaner_w9 TO authenticated;
GRANT ALL ON public.cleaner_w9 TO service_role;
REVOKE ALL ON public.cleaner_w9 FROM anon;

CREATE TABLE IF NOT EXISTS public.nec_1099_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_id uuid NOT NULL REFERENCES public.cleaners(id) ON DELETE RESTRICT,
  tax_year integer NOT NULL CHECK (tax_year >= 2026),
  form_revision text NOT NULL DEFAULT 'December 2026',
  corrected boolean NOT NULL DEFAULT false,
  corrects_form_id uuid REFERENCES public.nec_1099_forms(id) ON DELETE RESTRICT,
  account_number text NOT NULL,
  job_pay_cents integer NOT NULL CHECK (job_pay_cents >= 0),
  tip_cents integer NOT NULL CHECK (tip_cents >= 0),
  combined_cents integer NOT NULL CHECK (combined_cents >= 0),
  box_1a_cents integer NOT NULL CHECK (box_1a_cents >= 0),
  box_1b_cents integer CHECK (box_1b_cents IS NULL OR box_1b_cents > 0),
  box_1c_codes text[],
  box_1d_cents integer CHECK (box_1d_cents IS NULL OR box_1d_cents > 0),
  box_3_cents integer CHECK (box_3_cents IS NULL OR box_3_cents > 0),
  box_4_cents integer CHECK (box_4_cents IS NULL OR box_4_cents > 0),
  state_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  payer jsonb NOT NULL,
  recipient jsonb NOT NULL,
  efile jsonb NOT NULL,
  copy_b_pdf text NOT NULL,
  copy_c_pdf text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT nec_1099_correction_link CHECK (
    (corrected = false AND corrects_form_id IS NULL)
    OR (corrected = true AND corrects_form_id IS NOT NULL)
  ),
  CONSTRAINT nec_1099_tips_need_ttoc CHECK (
    box_1b_cents IS NULL
    OR (box_1c_codes IS NOT NULL AND cardinality(box_1c_codes) BETWEEN 1 AND 2)
  ),
  CONSTRAINT nec_1099_no_tips_no_ttoc CHECK (
    box_1b_cents IS NOT NULL OR box_1c_codes IS NULL
  ),
  CONSTRAINT nec_1099_combined CHECK (combined_cents = job_pay_cents + tip_cents),
  CONSTRAINT nec_1099_box_1a_includes_tips_once CHECK (box_1a_cents = job_pay_cents + tip_cents),
  CONSTRAINT nec_1099_pdfs_present CHECK (length(copy_b_pdf) > 20 AND length(copy_c_pdf) > 20)
);

COMMENT ON TABLE public.nec_1099_forms IS
  'Filed Form 1099-NEC Copy B and Copy C. Copy A is efile jsonb, not a PDF. Rows are immutable; corrections are new linked rows. Payer copies are retained with the row.';

COMMENT ON COLUMN public.nec_1099_forms.box_1d_cents IS
  'Qualified FLSA overtime premium only. Null when the pay model does not produce that figure. Never a placeholder zero.';

COMMENT ON COLUMN public.nec_1099_forms.box_3_cents IS
  'Excess golden parachute payments. Null for these contractor relationships.';

CREATE UNIQUE INDEX IF NOT EXISTS nec_1099_one_original
  ON public.nec_1099_forms (cleaner_id, tax_year)
  WHERE corrected = false;

CREATE INDEX IF NOT EXISTS nec_1099_cleaner_year_idx
  ON public.nec_1099_forms (cleaner_id, tax_year, created_at);

ALTER TABLE public.nec_1099_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nec_1099_forms_admin_read ON public.nec_1099_forms;
CREATE POLICY nec_1099_forms_admin_read ON public.nec_1099_forms
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS nec_1099_forms_service ON public.nec_1099_forms;
CREATE POLICY nec_1099_forms_service ON public.nec_1099_forms
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.nec_1099_forms TO authenticated;
GRANT ALL ON public.nec_1099_forms TO service_role;
REVOKE ALL ON public.nec_1099_forms FROM anon;

CREATE OR REPLACE FUNCTION public.nec_1099_forms_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'nec_1099_forms rows are immutable; a correction is a new linked record';
END;
$$;

DROP TRIGGER IF EXISTS nec_1099_forms_no_change ON public.nec_1099_forms;
CREATE TRIGGER nec_1099_forms_no_change
  BEFORE UPDATE OR DELETE ON public.nec_1099_forms
  FOR EACH ROW EXECUTE FUNCTION public.nec_1099_forms_immutable();

INSERT INTO public.app_settings (key, value, description)
VALUES
  (
    'nec_1099_payer',
    jsonb_build_object(
      'name', 'NovaraCleaning LLC',
      'tin', '',
      'street', '',
      'city', '',
      'state', '',
      'zip', '',
      'phone', ''
    ),
    'Payer identity for Form 1099-NEC (Rev. December 2026). Street, city, state, and ZIP are separate fields. TIN is the EIN and must be confirmed before filing.'
  ),
  (
    'nec_1099_ttoc',
    jsonb_build_object(
      'codes', '[]'::jsonb,
      'confirmed', false
    ),
    'Treasury Tipped Occupation Code for 1099-NEC box 1c. Confirm the cleaning occupation code with the accountant against the current IRS list before the first filing. Empty until confirmed. Do not assume a code.'
  )
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
