-- ─── Relax NOT NULL on leads.first_name + last_name ──────────────────
--
-- The lead-intake Edge Function passes `null` for first_name/last_name
-- when an email-only lead arrives (e.g. exit-intent capture form). The
-- previous migration set DEFAULT '' but DEFAULTs only fire when the
-- column is OMITTED from the INSERT, not when null is explicitly
-- passed. Relaxing NOT NULL on both columns lets the function succeed
-- without a deploy, and the lead-intake function also now derives a
-- friendly placeholder from the email local-part as a separate layer
-- of defense (see /supabase/functions/lead-intake/index.ts).
--
-- Existing rows are NOT NULL already so this is a pure schema relax;
-- no data is touched.

alter table public.leads
  alter column first_name drop not null,
  alter column last_name  drop not null;
