-- ─── Post-completion add-on charges (audit) ──────────────────────────────
--
-- Records every admin-initiated add-on added to a booking (including AFTER
-- it's marked completed), the recomputed price delta, and how it was
-- collected (off-session charge vs. hosted invoice). Gives an audit trail
-- and lets the admin UI show what was added + charged.

create table if not exists public.booking_addon_charges (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  added_addons text[] not null default '{}',
  removed_addons text[] not null default '{}',
  amount_cents integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending','paid','invoiced','failed','no_charge')),
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  hosted_invoice_url text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists booking_addon_charges_booking_idx on public.booking_addon_charges (booking_id);

alter table public.booking_addon_charges enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='booking_addon_charges' and policyname='bac_admin_read') then
    create policy bac_admin_read on public.booking_addon_charges for select to authenticated
      using (public.is_admin_or_va(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='booking_addon_charges' and policyname='bac_service_role') then
    create policy bac_service_role on public.booking_addon_charges for all to service_role using (true) with check (true);
  end if;
end $$;
