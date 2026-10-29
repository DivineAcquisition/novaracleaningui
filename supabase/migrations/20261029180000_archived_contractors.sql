-- Terminated contractors leave the directory. The archive keeps the
-- person so a later text can be matched without putting them back on screen.
-- Pay, tax, and job rows stay on the original cleaner id.

create table if not exists public.archived_contractors (
  id uuid primary key default gen_random_uuid(),
  cleaner_id uuid unique,
  first_name text,
  last_name text,
  email text,
  phone text,
  phone_digits text,
  status text,
  termination_reason text,
  termination_basis text,
  terminated_at timestamptz,
  engagement_end_action text,
  snapshot jsonb not null,
  archived_at timestamptz not null default now(),
  last_reply_at timestamptz,
  last_reply_text text,
  reply_count integer not null default 0
);

create index if not exists archived_contractors_phone_digits_idx
  on public.archived_contractors (phone_digits);

create index if not exists archived_contractors_email_idx
  on public.archived_contractors (lower(email));

create table if not exists public.archived_contractor_replies (
  id uuid primary key default gen_random_uuid(),
  archive_id uuid not null references public.archived_contractors(id) on delete cascade,
  channel text not null,
  body text not null,
  received_at timestamptz not null default now()
);

create index if not exists archived_contractor_replies_archive_idx
  on public.archived_contractor_replies (archive_id, received_at desc);

alter table public.archived_contractors enable row level security;
alter table public.archived_contractor_replies enable row level security;
revoke all on public.archived_contractors from anon, authenticated;
revoke all on public.archived_contractor_replies from anon, authenticated;

create or replace function public.archive_terminated_contractor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  digits text;
begin
  if lower(coalesce(new.status, '')) <> 'terminated'
     and lower(coalesce(new.engagement_end_action, '')) <> 'terminated' then
    return new;
  end if;
  digits := right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10);
  insert into public.archived_contractors (
    cleaner_id, first_name, last_name, email, phone, phone_digits, status,
    termination_reason, termination_basis, terminated_at, engagement_end_action, snapshot
  ) values (
    new.id, new.first_name, new.last_name, new.email, new.phone,
    nullif(digits, ''), new.status, new.termination_reason, new.termination_basis,
    new.terminated_at, new.engagement_end_action, to_jsonb(new)
  )
  on conflict (cleaner_id) do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    email = excluded.email,
    phone = excluded.phone,
    phone_digits = excluded.phone_digits,
    status = excluded.status,
    termination_reason = excluded.termination_reason,
    termination_basis = excluded.termination_basis,
    terminated_at = excluded.terminated_at,
    engagement_end_action = excluded.engagement_end_action,
    snapshot = excluded.snapshot,
    archived_at = now();
  return new;
end;
$$;

drop trigger if exists archive_terminated_contractor on public.cleaners;
create trigger archive_terminated_contractor
after insert or update on public.cleaners
for each row
execute function public.archive_terminated_contractor();

update public.cleaners
set updated_at = coalesce(updated_at, now())
where status = 'terminated' or engagement_end_action = 'terminated';
