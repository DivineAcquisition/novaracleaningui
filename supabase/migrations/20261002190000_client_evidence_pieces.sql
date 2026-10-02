-- Frozen per-client dispute evidence. A row is never updated in place.
-- A correction inserts a new version and marks the previous row superseded.

create table if not exists public.client_evidence_pieces (
  id uuid primary key default gen_random_uuid(),
  client_key text not null,
  booking_id uuid,
  charge_key text,
  kind text not null,
  series_id text not null,
  version integer not null,
  event_id text not null unique,
  reason text not null,
  fingerprint text not null,
  generated_at timestamptz not null,
  backfill boolean not null default false,
  superseded boolean not null default false,
  lines jsonb not null,
  gaps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists client_evidence_pieces_booking_idx
  on public.client_evidence_pieces (booking_id, kind, superseded);

alter table public.client_evidence_pieces enable row level security;

drop policy if exists "admins read client evidence" on public.client_evidence_pieces;
create policy "admins read client evidence" on public.client_evidence_pieces
  for select using (public.is_admin_or_va(auth.uid()));
