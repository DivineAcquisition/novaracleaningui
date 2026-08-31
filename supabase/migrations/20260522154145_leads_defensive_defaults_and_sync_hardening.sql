-- ─── Sync-hardening defaults ──────────────────────────────────────────
--
-- public.leads currently has NOT NULL constraints on first_name and
-- last_name with no defaults — which means lead-intake's INSERT path
-- (called from website forms, FB lead-ads webhooks, and the exit-intent
-- capture flow) used to fail with a NOT NULL violation any time the
-- form only collected an email address. The Edge Function (lead-intake)
-- now derives sensible placeholders, but defending the DB itself with
-- defaults means a downstream caller can't reintroduce the same bug.

alter table public.leads
  alter column first_name set default '',
  alter column last_name  set default '';

-- Existing rows are already populated (NOT NULL). The default only
-- matters for future INSERTs that omit the column.

comment on column public.leads.first_name is
  'Derived from form input or email local-part when missing. Default '''' to keep INSERTs from failing on lead-intake calls that only carry an email.';
comment on column public.leads.last_name is
  'Same defaulting rationale as first_name.';
