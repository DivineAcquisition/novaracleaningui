-- Personal cleaning checklist sessions, and the one membership offer
-- sent after a completed cleaning.
--
-- The checklist email is no longer fired by a status trigger. Confirmation
-- sends it once, after payment, for every service type.

create table if not exists public.customer_checklist_sessions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  token text not null unique,
  email text,
  checklist_type text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0
);

alter table public.customer_checklist_sessions enable row level security;

create table if not exists public.membership_welcome_offers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  email text not null,
  first_name text,
  token text not null unique,
  promo_code text not null unique,
  percent_off integer not null default 15,
  status text not null default 'pending' check (status in ('pending', 'sent', 'claimed')),
  sent_at timestamptz,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists membership_welcome_offers_email_idx
  on public.membership_welcome_offers (lower(email));

alter table public.membership_welcome_offers enable row level security;

-- Let the welcome code live beside the older promo audiences.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'promo_codes'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%applies_to%'
  loop
    execute format('alter table public.promo_codes drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.promo_codes
  add constraint promo_codes_applies_to_check
  check (applies_to in (
    'all',
    'new_customers',
    'returning_customers',
    'testimonial_second_clean',
    'membership_welcome'
  ));

-- 15% off the first month is an approved claim when the email says so.
update public.app_settings
set value = coalesce(value, '[]'::jsonb) || jsonb_build_array(
  jsonb_build_object(
    'id', 'savings_percent',
    'phrase', '15% off',
    'basis', 'Owner-approved offer: 15% off the first month of a Glow membership, sent once after a completed cleaning. One per household. Expires 30 days after that cleaning.',
    'conditional', true,
    'requiredWording', 'first month of a Glow membership',
    'active', true
  )
)
where key = 'email_approved_claims'
  and not exists (
    select 1 from jsonb_array_elements(coalesce(value, '[]'::jsonb)) as claim
    where claim->>'id' = 'savings_percent'
      and claim->>'requiredWording' = 'first month of a Glow membership'
  );

-- Confirmation now sends the checklist. This trigger used to send a second
-- copy, and only for standard cleans, including before payment settled.
create or replace function public.trigger_send_maintenance_checklist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;

comment on function public.trigger_send_maintenance_checklist() is
  'Retired. The personal checklist email is sent with the booking confirmation, once, after payment.';
