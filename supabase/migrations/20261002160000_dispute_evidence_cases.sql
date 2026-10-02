-- Draft and submitted Stripe dispute evidence. Submitted rows are not edited
-- by the application except to record the outcome.

create table if not exists public.dispute_evidence_cases (
  id uuid primary key default gen_random_uuid(),
  stripe_dispute_id text unique not null,
  booking_id uuid,
  reason text,
  evidence_due_at timestamptz,
  status text not null default 'draft',
  summary jsonb not null default '[]'::jsonb,
  text_fields jsonb not null default '{}'::jsonb,
  narrative text,
  stripe_file_ids jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  missing jsonb not null default '[]'::jsonb,
  submitted_at timestamptz,
  outcome text,
  outcome_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dispute_evidence_cases enable row level security;

drop policy if exists "admins read dispute evidence" on public.dispute_evidence_cases;
create policy "admins read dispute evidence" on public.dispute_evidence_cases
  for select using (public.is_admin_or_va(auth.uid()));
