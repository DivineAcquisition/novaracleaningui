-- One saved application per tokenized link.
-- Indeed applicants are keyed by their Indeed relay email so a second pass
-- reuses the same link instead of starting a second application.

create table if not exists public.hiring_application_sessions (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  email text not null,
  full_name text,
  phone text,
  source text not null default 'indeed',
  job_title text,
  gmail_thread_id text,
  gmail_message_id text,
  answers jsonb not null default '{}'::jsonb,
  step_index integer not null default 0,
  status text not null default 'open',
  expires_at timestamptz not null,
  submitted_at timestamptz,
  applicant_id uuid,
  invite_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hiring_application_sessions_status_check
    check (status in ('open', 'submitted'))
);

create unique index if not exists hiring_application_sessions_email_source_key
  on public.hiring_application_sessions (lower(email), source);

create index if not exists hiring_application_sessions_status_idx
  on public.hiring_application_sessions (status, expires_at);

comment on table public.hiring_application_sessions is
  'Tokenized hiring applications. The link is the session: answers autosave here until the person submits.';

alter table public.hiring_application_sessions enable row level security;
