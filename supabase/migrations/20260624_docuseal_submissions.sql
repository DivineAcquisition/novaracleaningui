-- ─── DocuSeal agreement submissions tracking ─────────────────────────────────
--
-- Records every agreement sent for e-signature via DocuSeal (one-time,
-- membership, STR host, contractor / VA contractor) and the signed result that
-- comes back on the completion webhook. Writes happen server-side with the
-- service role (/api/docuseal/*); RLS only gates direct admin/VA reads.

create table if not exists public.docuseal_submissions (
  id uuid primary key default gen_random_uuid(),
  audience text not null,                 -- one_time | membership | str_host | contractor | va_contractor
  template_id text,                       -- DocuSeal template id used
  submission_id text,                     -- DocuSeal submission id
  submitter_email text not null,
  submitter_name text,
  role text,                              -- DocuSeal submitter role (Client/Member/Host/Contractor)
  status text not null default 'sent',    -- sent | opened | completed | declined
  signing_url text,                       -- embed/sign URL returned by DocuSeal
  document_url text,                      -- signed PDF URL (set on completion)
  audit_log_url text,
  -- Optional links back to the originating record (best-effort, nullable).
  booking_id uuid,
  host_email text,
  cleaner_id uuid,
  created_by text,                        -- admin email that triggered the send
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_docuseal_submissions_email on public.docuseal_submissions (submitter_email);
create index if not exists idx_docuseal_submissions_submission on public.docuseal_submissions (submission_id);
create index if not exists idx_docuseal_submissions_status on public.docuseal_submissions (status, created_at desc);

alter table public.docuseal_submissions enable row level security;

-- Admin/VA may read; everyone else is denied. (Server writes bypass RLS via the
-- service role.)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'docuseal_submissions'
      and policyname = 'docuseal_admin_va_read'
  ) then
    create policy docuseal_admin_va_read on public.docuseal_submissions
      for select
      using (public.is_admin_or_va(auth.uid()));
  end if;
end$$;
