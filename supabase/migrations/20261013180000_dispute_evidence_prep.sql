-- Per-client dispute evidence: identification stored with each frozen piece,
-- and a lost-dispute review on the case. Submitted evidence is not rewritten.

alter table public.client_evidence_pieces
  add column if not exists identity jsonb;

alter table public.dispute_evidence_cases
  add column if not exists loss_cause text,
  add column if not exists loss_note text,
  add column if not exists fingerprint_mismatches jsonb not null default '[]'::jsonb,
  add column if not exists ready_at_arrival boolean;

create index if not exists client_evidence_pieces_client_idx
  on public.client_evidence_pieces (client_key, kind, superseded);
