-- Recurring P&L overhead (insurance, VA labor, software from live integrations).
-- pl-sheet-sync expands these into dated rows on the Overhead tab and also
-- appends them to Expenses & Reimb so True Net includes fixed costs.

CREATE TABLE IF NOT EXISTS public.pl_overhead (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('Insurance', 'Labor', 'Software', 'Other')),
  vendor text NOT NULL,
  description text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  cadence text NOT NULL CHECK (cadence IN ('monthly', 'biweekly')),
  start_date date NOT NULL DEFAULT '2026-05-01',
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, vendor)
);

CREATE INDEX IF NOT EXISTS pl_overhead_active_idx ON public.pl_overhead (is_active, category);

ALTER TABLE public.pl_overhead ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pl_overhead_admin_all ON public.pl_overhead;
CREATE POLICY pl_overhead_admin_all ON public.pl_overhead
  FOR ALL TO authenticated
  USING (public.is_admin_or_va(auth.uid()))
  WITH CHECK (public.is_admin_or_va(auth.uid()));
DROP POLICY IF EXISTS pl_overhead_service_role ON public.pl_overhead;
CREATE POLICY pl_overhead_service_role ON public.pl_overhead
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_touch_pl_overhead ON public.pl_overhead;
CREATE TRIGGER trg_touch_pl_overhead BEFORE UPDATE ON public.pl_overhead
  FOR EACH ROW EXECUTE FUNCTION public.touch_pl_updated_at();

-- Founder-stated amounts
INSERT INTO public.pl_overhead
  (category, vendor, description, amount_cents, cadence, start_date, notes, source)
VALUES
  (
    'Insurance',
    'Business insurance (VA + MD)',
    'Combined liability / business insurance for Virginia and Maryland',
    10700,
    'monthly',
    '2026-05-01',
    'Founder-stated: $107 total covering VA & MD.',
    'manual'
  ),
  (
    'Labor',
    'VA contractor',
    'Virtual assistant — $160 every 2 weeks',
    16000,
    'biweekly',
    '2026-05-01',
    'Founder-stated. Monthly equivalent ≈ $346.67 (26 pay periods / 12).',
    'manual'
  )
ON CONFLICT (category, vendor) DO UPDATE SET
  description = EXCLUDED.description,
  amount_cents = EXCLUDED.amount_cents,
  cadence = EXCLUDED.cadence,
  notes = EXCLUDED.notes,
  source = EXCLUDED.source,
  is_active = true,
  updated_at = NOW();

-- Software: list-price estimates for integrations actually wired in this stack.
-- Stripe is usage/% of revenue (not a fixed subscription) — omitted on purpose.
-- Discord is free. Expo EAS stays on the free tier unless a paid plan is confirmed.
INSERT INTO public.pl_overhead
  (category, vendor, description, amount_cents, cadence, start_date, notes, source)
VALUES
  ('Software', 'GoHighLevel', 'CRM, SMS, pipelines, calendars (Starter list price)', 9700, 'monthly', '2026-05-01', 'Wired: GHL_LOCATION_ID / PIT / SMS / pipelines. Starter $97/mo for a single location. Upgrade to Unlimited ($297) if that is the live plan.', 'integration_estimate'),
  ('Software', 'Supabase', 'Database, Auth, Edge Functions (Pro list price)', 2500, 'monthly', '2026-05-01', 'Production project sxdraeptzuamsgjcvfeg. Pro $25/mo; usage overages extra.', 'integration_estimate'),
  ('Software', 'Vercel', 'Next.js hosting (Pro list price)', 2000, 'monthly', '2026-05-01', 'App + admin + contractor hosts. Pro $20/mo.', 'integration_estimate'),
  ('Software', 'Resend', 'Transactional email (Pro list price)', 2000, 'monthly', '2026-05-01', 'RESEND_API_KEY. Pro $20/mo; high volume billed per email.', 'integration_estimate'),
  ('Software', 'Airtable', 'Jobs / payroll / revenue-ops bases (Team 1 seat)', 2000, 'monthly', '2026-05-01', 'Multiple bases (jobs, payroll, ad spend, weekly reports). Team ~$20/seat/mo.', 'integration_estimate'),
  ('Software', 'DocuSeal', 'Contractor / membership / host agreements', 1900, 'monthly', '2026-05-01', 'DOCUSEAL_* templates. Cloud starter ~$19/mo.', 'integration_estimate'),
  ('Software', 'Google Workspace', 'Drive + Calendar impersonation (Business Starter)', 700, 'monthly', '2026-05-01', 'GOOGLE_DRIVE_IMPERSONATE_EMAIL. ~$7/user/mo.', 'integration_estimate'),
  ('Software', 'Google Maps Platform', 'Places autocomplete + geocoding (usage reserve)', 2000, 'monthly', '2026-05-01', 'GOOGLE_PLACES_* / GEOCODING keys. Usage-based; $20 reserve until invoices are pasted.', 'integration_estimate'),
  ('Software', 'Apploye', 'Cleaner GPS / time tracking', 2000, 'monthly', '2026-05-01', 'APPLOYE_API_KEY. ~$2.50–$6/user; $20 covers a small active crew.', 'integration_estimate'),
  ('Software', 'Zapier', 'Webhook automations (Professional list price)', 2000, 'monthly', '2026-05-01', 'ZAPIER_VA_HOOK_URL. Professional ~$20/mo.', 'integration_estimate'),
  ('Software', 'Telnyx', 'SMS fallback (usage reserve)', 1000, 'monthly', '2026-05-01', 'Fallback when GHL SMS fails. Usage-based; $10 reserve.', 'integration_estimate')
ON CONFLICT (category, vendor) DO UPDATE SET
  description = EXCLUDED.description,
  amount_cents = EXCLUDED.amount_cents,
  cadence = EXCLUDED.cadence,
  notes = EXCLUDED.notes,
  source = EXCLUDED.source,
  is_active = true,
  updated_at = NOW();
