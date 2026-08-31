-- ─── VA onboarding & access provisioning ────────────────────────────────────
--
-- One row per VA moving through: started (identity captured) → signed (VA
-- Independent Contractor Agreement executed via DocuSeal) → submitted
-- (onboarding form complete — sits in the admin approval queue) → approved
-- (access provisioned: GHL USER seat + internal admin-workspace 'va' role) |
-- rejected → offboarded (all access revoked in one logged action).
--
-- Email is the identity key across every system (GHL user, portal user,
-- notifications). No access is provisioned before BOTH a signed agreement and
-- explicit admin approval.

CREATE TABLE IF NOT EXISTS public.va_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  first_name text,
  last_name text,
  phone text,
  va_role text NOT NULL DEFAULT 'operations',   -- operations | sales | recruiting | all
  timezone text,
  working_hours text,
  experience text,
  tools text,
  notes text,

  status text NOT NULL DEFAULT 'started',       -- started|signed|submitted|approved|rejected|offboarded
  agreement_submission_id text,
  agreement_signed_at timestamptz,
  submitted_at timestamptz,

  approved_by uuid,
  approved_at timestamptz,
  rejected_reason text,

  ghl_user_id text,
  portal_user_id uuid,
  provisioned_at timestamptz,

  offboarded_at timestamptz,
  offboarded_by uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One live onboarding per email (case-insensitive identity key).
CREATE UNIQUE INDEX IF NOT EXISTS va_onboarding_email_uniq
  ON public.va_onboarding (lower(email));
CREATE INDEX IF NOT EXISTS va_onboarding_status_idx ON public.va_onboarding (status);

ALTER TABLE public.va_onboarding ENABLE ROW LEVEL SECURITY;

-- Admins/VAs read the queue in the workspace; all writes flow through the
-- service-role API route / edge function (no self-escalation path).
DROP POLICY IF EXISTS va_onboarding_admin_read ON public.va_onboarding;
CREATE POLICY va_onboarding_admin_read ON public.va_onboarding
  FOR SELECT TO authenticated
  USING (public.is_admin_or_va(auth.uid()));

-- Discord: surface new submissions to the ops team.
INSERT INTO public.discord_routes (event_type, webhook_key, role_keys) VALUES
  ('va.onboarding_submitted', 'DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('va.provisioned',          'DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS']),
  ('va.offboarded',           'DISCORD_WEBHOOK_CLEANERS', ARRAY['DISCORD_ROLE_OPERATIONS'])
ON CONFLICT (event_type) DO UPDATE
  SET webhook_key = EXCLUDED.webhook_key, role_keys = EXCLUDED.role_keys, enabled = true;

NOTIFY pgrst, 'reload schema';
