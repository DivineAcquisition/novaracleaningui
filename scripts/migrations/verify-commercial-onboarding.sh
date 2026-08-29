#!/usr/bin/env bash
# ─── Local validation for the commercial onboarding session migration ───────
#
# The commercial pipeline this migration extends is not yet applied to the
# hosted project, so there is nothing to validate against there. This spins up
# a throwaway local Postgres, stubs the Supabase platform objects our
# migrations assume (auth/storage schemas, a couple of helper functions), then
# applies the real commercial migration chain in order followed by the new one.
#
# It is a syntax and dependency check, not a behavioural test of Supabase —
# but it catches the things that actually break a deploy: a missing column, a
# function signature that drifted, a policy referencing a table that does not
# exist yet, a CHECK that contradicts a default.
#
#   bash scripts/migrations/verify-commercial-onboarding.sh
#
# Requires: postgresql-16 client + server binaries on the box.

set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/tmp/pgdata-commercial}
PGPORT=${PGPORT:-5433}
PGHOST=/tmp
DB=commercial_check
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG="$ROOT/supabase/migrations"

psql_run() { psql -h "$PGHOST" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }

if ! "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  rm -rf "$PGDATA"; mkdir -p "$PGDATA"; chmod 700 "$PGDATA"
  "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
  "$PGBIN/pg_ctl" -D "$PGDATA" -l /tmp/pg-commercial.log -o "-p $PGPORT -k $PGHOST" start >/dev/null
  sleep 2
fi

psql_run -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
psql_run -d postgres -c "CREATE DATABASE $DB;" >/dev/null

# ── Supabase platform stubs ────────────────────────────────────────────────
# Only what our migrations reference. Deliberately minimal: if a migration
# starts depending on something new, this file should have to change too.
psql_run -d "$DB" >/dev/null <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text, public boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text, name text, owner uuid,
  created_at timestamptz DEFAULT now(), metadata jsonb
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE ROLE authenticated;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role;   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
SQL

# ── Baseline objects the commercial chain assumes already exist ────────────
# These come from much older migrations that are entangled with the rest of
# the app; recreating the whole history locally would test nothing useful.
psql_run -d "$DB" >/dev/null <<'SQL'
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid
);

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  source text,
  summary text,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.discord_routes (
  event_type text PRIMARY KEY,
  webhook_key text NOT NULL,
  role_keys text[] DEFAULT ARRAY[]::text[],
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.qc_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid,
  issue_type text,
  severity text,
  status text DEFAULT 'open',
  title text,
  description text,
  details jsonb DEFAULT '{}'::jsonb,
  reported_via text,
  reported_by_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number integer,
  first_name text, last_name text, email text, phone text,
  address text, city text, state text, zip_code text,
  service_type text, service_date date, time_slot text,
  status text DEFAULT 'pending_payment',
  total_estimate_cents integer, final_charge_cents integer,
  business_account_id uuid, business_site_id uuid,
  cleaner_id uuid,
  partner_details jsonb DEFAULT '{}'::jsonb,
  recommended_crew_size integer,
  num_cleaners_assigned integer,
  booking_channel text,
  add_ons jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text, last_name text, email text, phone text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.cleaners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text, last_name text, email text, phone text,
  status text DEFAULT 'active', approved boolean DEFAULT false,
  available_for_bookings boolean DEFAULT true,
  walkthrough_eligible boolean DEFAULT false,
  novara_score numeric, zip_code text,
  user_id uuid,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid,
  status text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.job_duration_actuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  job_id uuid, cleaner_id uuid, service_date date,
  service_type text NOT NULL, home_size_id text, condition_level text,
  projected_hours numeric(6,2) NOT NULL, actual_hours numeric(6,2) NOT NULL,
  variance_hours numeric(6,2) GENERATED ALWAYS AS (actual_hours - projected_hours) STORED,
  variance_pct numeric(7,2) GENERATED ALWAYS AS
    (ROUND((actual_hours - projected_hours) / projected_hours * 100, 2)) STORED,
  scheduled_start_at timestamptz, actual_start_at timestamptz, actual_end_at timestamptz,
  started_late_minutes integer,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.job_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid, booking_id uuid, cleaner_id uuid,
  status text DEFAULT 'offered',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.cleaner_pay_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_crew_size integer NOT NULL,
  max_crew_size integer,
  pay_tier text NOT NULL,
  rate_percent numeric NOT NULL,
  note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid
);

CREATE OR REPLACE FUNCTION public.is_admin_or_va(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
SQL

echo "Applying commercial migration chain…"
CHAIN=(
  20260622230600_b2b_commercial_partnership.sql
  20260711174143_partnerships_hub.sql
  20260711160000_business_sites.sql
  20260711170000_partner_internal_booking.sql
  20260824120000_commercial_pricing_walkthrough.sql
  20260824170000_coi_lifecycle.sql
  20260824190000_walkthrough_pipeline.sql
  20260824210000_commercial_proposal_billing.sql
  20260824223000_commercial_hub_console_paths.sql
  20260829200000_commercial_onboarding_session.sql
)

for f in "${CHAIN[@]}"; do
  path="$MIG/$f"
  if [ ! -f "$path" ]; then
    # Filenames drift; find by the descriptive suffix instead of failing.
    suffix="${f#*_}"
    path=$(ls "$MIG"/*"$suffix" 2>/dev/null | head -1 || true)
  fi
  if [ -z "${path:-}" ] || [ ! -f "$path" ]; then
    echo "  SKIP  $f (not found)"
    continue
  fi
  printf '  %-58s' "$(basename "$path")"
  if psql_run -d "$DB" -f "$path" >/tmp/mig.out 2>&1; then
    echo "ok"
  else
    echo "FAILED"
    echo "──────────────────────────────────────────────────────────"
    grep -E "^(psql:|ERROR|DETAIL|HINT|CONTEXT)" /tmp/mig.out | head -25
    echo "──────────────────────────────────────────────────────────"
    exit 1
  fi
done

echo
echo "Checking the new objects landed…"
psql_run -d "$DB" -t <<'SQL'
SELECT '  table  ' || table_name FROM information_schema.tables
 WHERE table_schema='public' AND table_name LIKE 'commercial_onboarding%'
UNION ALL
SELECT '  view   ' || table_name FROM information_schema.views
 WHERE table_schema='public' AND table_name LIKE 'commercial_onboarding%'
UNION ALL
SELECT '  func   ' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'commercial_onboarding%'
UNION ALL
SELECT '  column business_accounts.' || column_name FROM information_schema.columns
 WHERE table_name='business_accounts'
   AND column_name IN ('preferred_billing_method','portal_user_id','portal_created_at')
ORDER BY 1;
SQL

echo
echo "Exercising the progress function end to end…"
psql_run -d "$DB" -t <<'SQL'
DO $$
DECLARE
  v_account uuid; v_site uuid; v_proposal uuid; v_agreement uuid; v_session uuid;
  v_progress jsonb;
BEGIN
  INSERT INTO public.business_accounts (business_name, account_type, email, contact_name)
  VALUES ('Harbor Point Dental', 'office', 'ap@example.test', 'Nadia Okonkwo')
  RETURNING id INTO v_account;

  INSERT INTO public.business_sites (business_account_id, nickname, address, sqft, active)
  VALUES (v_account, 'Main office', '1 Example Plaza', 1800, true)
  RETURNING id INTO v_site;

  -- A sent proposal must carry a token, an expiry and a recipient — the
  -- commercial_proposals_sent_shape_chk constraint enforces it.
  INSERT INTO public.commercial_proposals
    (business_account_id, version, status, billing_method,
     token, expires_at, recipient_name, recipient_email)
  VALUES (v_account, 1, 'sent', 'invoiced',
          public.mint_commercial_token(), now() + interval '14 days',
          'Nadia Okonkwo', 'ap@example.test')
  RETURNING id INTO v_proposal;

  INSERT INTO public.commercial_proposal_sites
    (proposal_id, business_site_id, nickname, address, per_visit_price_cents)
  VALUES (v_proposal, v_site, 'Main office', '1 Example Plaza', 28080);

  INSERT INTO public.commercial_onboarding_sessions
    (business_account_id, proposal_id, token, expires_at, billing_method,
     recipient_name, recipient_email, sent_at)
  VALUES (v_account, v_proposal, public.mint_commercial_token(),
          now() + interval '30 days', 'invoiced', 'Nadia Okonkwo', 'ap@example.test', now())
  RETURNING id INTO v_session;

  v_progress := public.commercial_onboarding_progress(v_session);
  RAISE NOTICE 'step 1 (nothing done)     -> current=%  complete=%',
    v_progress->>'current_step', v_progress->>'complete';
  ASSERT v_progress->>'current_step' = 'pricing', 'expected pricing first';

  -- Client requests changes: the session must pause, not advance.
  UPDATE public.commercial_proposals
     SET status='changes_requested', changes_requested_at=now(),
         change_request_note='Please split the invoice by site.'
   WHERE id = v_proposal;
  v_progress := public.commercial_onboarding_progress(v_session);
  RAISE NOTICE 'after request changes     -> current=%  paused=%',
    v_progress->>'current_step', v_progress->>'paused_for_changes';
  ASSERT v_progress->>'current_step' = 'paused', 'expected paused';

  -- Accepted, agreement generated.
  UPDATE public.commercial_proposals
     SET status='accepted', accepted_at=now(), accepted_by_name='Nadia',
         changes_requested_at=NULL, change_request_note=NULL
   WHERE id = v_proposal;

  INSERT INTO public.commercial_agreements
    (business_account_id, proposal_id, status, term, billing_method,
     invoice_cycle, net_terms, signer_name, signer_email, expires_at)
  VALUES (v_account, v_proposal, 'pending', 'month_to_month', 'invoiced',
          'monthly', 'net_30', 'Nadia Okonkwo', 'ap@example.test', now() + interval '30 days')
  RETURNING id INTO v_agreement;
  UPDATE public.commercial_onboarding_sessions SET agreement_id = v_agreement WHERE id = v_session;

  v_progress := public.commercial_onboarding_progress(v_session);
  RAISE NOTICE 'after accept              -> current=%', v_progress->>'current_step';
  ASSERT v_progress->>'current_step' = 'agreement', 'expected agreement';

  -- Signed.
  UPDATE public.commercial_agreements
     SET status='signed', signed_at=now(), signed_by_name='Nadia Okonkwo'
   WHERE id = v_agreement;
  v_progress := public.commercial_onboarding_progress(v_session);
  RAISE NOTICE 'after signature           -> current=%', v_progress->>'current_step';
  ASSERT v_progress->>'current_step' = 'billing', 'expected billing';

  -- Invoiced billing configured (the generated `configured` column flips).
  INSERT INTO public.commercial_billing_profiles
    (business_account_id, agreement_id, method, billing_contact_email,
     invoice_cycle, net_terms)
  VALUES (v_account, v_agreement, 'invoiced', 'ap@example.test', 'monthly', 'net_30');
  v_progress := public.commercial_onboarding_progress(v_session);
  RAISE NOTICE 'after billing             -> current=%', v_progress->>'current_step';
  ASSERT v_progress->>'current_step' = 'portal', 'expected portal';

  -- Portal login created.
  UPDATE public.business_accounts
     SET portal_user_id = gen_random_uuid(), portal_created_at = now()
   WHERE id = v_account;
  v_progress := public.commercial_onboarding_progress(v_session);
  RAISE NOTICE 'after portal              -> current=%  complete=%',
    v_progress->>'current_step', v_progress->>'complete';
  ASSERT v_progress->>'current_step' = 'done', 'expected done';
  ASSERT (v_progress->>'complete')::boolean, 'expected complete';

  -- The admin view must agree, and must not report a finished session stalled.
  PERFORM 1 FROM public.commercial_onboarding_sessions_v1 WHERE id = v_session AND complete = true;
  ASSERT FOUND, 'view did not report the session complete';
  PERFORM 1 FROM public.commercial_onboarding_sessions_v1 WHERE id = v_session AND stalled = false;
  ASSERT FOUND, 'a completed session must never be stalled';

  RAISE NOTICE 'ALL ASSERTIONS PASSED';
END $$;
SQL

echo
echo "Checking the stall window…"
psql_run -d "$DB" -t <<'SQL'
DO $$
DECLARE v_account uuid; v_session uuid; v_stalled boolean;
BEGIN
  INSERT INTO public.business_accounts (business_name, account_type, email)
  VALUES ('Ridgeline Logistics', 'commercial', 'ops@example.test') RETURNING id INTO v_account;

  INSERT INTO public.commercial_onboarding_sessions
    (business_account_id, token, expires_at, billing_method, sent_at, last_activity_at)
  VALUES (v_account, public.mint_commercial_token(), now() + interval '30 days',
          'auto_pay', now() - interval '10 days', now() - interval '10 days')
  RETURNING id INTO v_session;

  SELECT stalled INTO v_stalled FROM public.commercial_onboarding_sessions_v1 WHERE id = v_session;
  RAISE NOTICE 'idle 10 days, 72h window  -> stalled=%', v_stalled;
  ASSERT v_stalled, 'expected an idle session to be stalled';

  UPDATE public.commercial_onboarding_sessions SET last_activity_at = now() WHERE id = v_session;
  SELECT stalled INTO v_stalled FROM public.commercial_onboarding_sessions_v1 WHERE id = v_session;
  ASSERT NOT v_stalled, 'activity must clear the stall flag';
  RAISE NOTICE 'after activity            -> stalled=%', v_stalled;
END $$;
SQL

echo
echo "Checking the one-live-session rule…"
psql_run -d "$DB" -t <<'SQL'
DO $$
DECLARE v_account uuid; v_err text;
BEGIN
  SELECT id INTO v_account FROM public.business_accounts WHERE business_name = 'Ridgeline Logistics';
  BEGIN
    INSERT INTO public.commercial_onboarding_sessions
      (business_account_id, token, expires_at, billing_method)
    VALUES (v_account, public.mint_commercial_token(), now() + interval '30 days', 'auto_pay');
    RAISE EXCEPTION 'a second active session was allowed';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'second active session      -> correctly rejected';
  END;
END $$;
SQL

echo
echo "Migration chain verified."
