-- ─── VA agreement pay type (base vs hourly) ──────────────────────────────
-- Admins choose which VA Independent Contractor Agreement to send when they
-- email an offer: the base-pay template (default) or the "V2 Hourly" template.
-- The onboarding wizard then routes the signature to the matching DocuSeal
-- template (audience va_contractor vs va_contractor_hourly).

alter table public.va_onboarding
  add column if not exists pay_type text not null default 'base'
  check (pay_type in ('base', 'hourly'));

-- Admins/VAs set the pay type from the Team console right after sending the
-- offer (the offer edge function creates the row; the console stamps pay_type).
-- Only a SELECT policy existed before, so add a scoped admin UPDATE policy.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'va_onboarding'
      and policyname = 'va_onboarding_admin_update'
  ) then
    create policy va_onboarding_admin_update on public.va_onboarding
      for update to authenticated
      using (public.is_admin_or_va(auth.uid()))
      with check (public.is_admin_or_va(auth.uid()));
  end if;
end$$;
