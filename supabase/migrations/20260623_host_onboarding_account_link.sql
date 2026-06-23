-- ─── Host onboarding → portal account linkage ────────────────────────────
--
-- Seamless auth: when a host submits the onboarding form we provision their
-- Host Portal account (auth user + hosts row + Pending-Pricing properties) in
-- the same request. These columns let the submission record point at the
-- account it created so the ops queue and any later re-sync are idempotent.

alter table public.host_onboarding_submissions add column if not exists user_id uuid;
alter table public.host_onboarding_submissions add column if not exists host_id uuid;
alter table public.host_onboarding_submissions add column if not exists account_created boolean not null default false;

create index if not exists host_onboarding_user_id_idx on public.host_onboarding_submissions (user_id);
create index if not exists host_onboarding_host_id_idx on public.host_onboarding_submissions (host_id);
