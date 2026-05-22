-- ─── Fix: cleaners get bounced between /cleaner/auth, /cleaner/onboarding,
-- ─── and /cleaner/dashboard in an infinite loop ─────────────────────────
--
-- Root cause
-- ----------
-- Almost every cleaner row in `public.cleaners` has `user_id IS NULL` —
-- because they were either:
--   1. Created by an admin invite (admin tooling never knew the auth uid)
--   2. Migrated from a previous platform with no auth user attached yet
--   3. Existed before they completed Google OAuth / email signup
--
-- The Dashboard / Auth / AuthCallback views all gate on
-- `WHERE user_id = session.user.id`. RLS is strict (only `user_id =
-- auth.uid()` can SELECT / UPDATE), so the cleaner can NEVER see or
-- update their own row from the client. They get bounced to
-- `/cleaner/onboarding`, the wizard INSERTs a duplicate (which fails
-- with 23505 on the unique email index), the error path forwards them
-- to `/cleaner/dashboard`, which bounces them BACK to onboarding — loop.
--
-- Additionally, even when the link exists, some cleaner rows have
-- `onboarding_complete = false` despite having `first_name`, `phone`,
-- and `home_zip` populated (i.e. they finished the wizard in a previous
-- version that didn't stamp the flag). Same loop.
--
-- This migration adds a `security definer` RPC that:
--   * Returns the cleaner row attached to the calling auth user.
--   * Auto-links by email when the row exists but is unlinked.
--   * Auto-promotes `onboarding_complete = true` when basics are filled.
--   * Returns NULL when no row exists at all (so the client routes the
--     cleaner to the onboarding wizard for genuine first-time signups).
--
-- It also does a one-time back-fill for every cleaner row whose email
-- matches an existing `auth.users.email` (so existing cleaners stop
-- looping the next time they sign in without anyone having to manually
-- link them in the DB).

-- ─── Back-fill user_id for existing cleaner rows by email ─────────────
update public.cleaners c
set user_id = u.id,
    updated_at = now()
from auth.users u
where c.user_id is null
  and c.email is not null
  and lower(u.email) = lower(c.email);

-- ─── Promote onboarding_complete=true on any row that looks done ──────
update public.cleaners
set onboarding_complete = true,
    activated_at = coalesce(activated_at, now()),
    updated_at = now()
where coalesce(onboarding_complete, false) = false
  and first_name is not null and first_name <> ''
  and last_name is not null  and last_name  <> ''
  and phone is not null      and phone      <> ''
  and home_zip is not null   and home_zip   <> '';

-- ─── RPC: resolve_or_link_cleaner_for_user ────────────────────────────
-- Single entry point the client uses for every auth-gated cleaner view.
-- Idempotent. Always returns at most one row.
--
-- Behavior:
--   * No session            → returns 0 rows
--   * Cleaner row linked    → returns it (auto-promoting onboarding_complete
--                             if basics are filled but flag was false)
--   * Cleaner row unlinked  → links via email match, then returns it
--   * No matching row       → returns 0 rows (caller routes to wizard)

drop function if exists public.resolve_or_link_cleaner_for_user(text);

create or replace function public.resolve_or_link_cleaner_for_user(p_email text)
returns table (
  id uuid,
  user_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  home_zip text,
  onboarding_complete boolean,
  approved boolean,
  status text,
  stripe_account_id text,
  payouts_enabled boolean,
  phone_verified boolean,
  pay_rate_hr numeric,
  was_linked boolean,
  was_auto_promoted boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row public.cleaners%rowtype;
  v_was_linked boolean := false;
  v_was_promoted boolean := false;
begin
  if v_uid is null then
    return;
  end if;

  -- 1. Already linked by user_id
  select * into v_row from public.cleaners c where c.user_id = v_uid limit 1;

  -- 2. Not linked — try to attach by email (case-insensitive)
  if v_row.id is null and v_email <> '' then
    select * into v_row
    from public.cleaners c
    where lower(c.email) = v_email and c.user_id is null
    limit 1;

    if v_row.id is not null then
      update public.cleaners
      set user_id = v_uid,
          activated_at = coalesce(activated_at, now()),
          updated_at = now()
      where public.cleaners.id = v_row.id
      returning * into v_row;
      v_was_linked := true;
    end if;
  end if;

  if v_row.id is null then
    return;  -- no cleaner row at all; caller routes to onboarding wizard
  end if;

  -- 3. Auto-promote onboarding_complete when profile basics are filled.
  -- This unsticks rows created by admin invites / earlier wizard versions
  -- that forgot to flip the flag at the end.
  if not coalesce(v_row.onboarding_complete, false)
     and v_row.first_name is not null and v_row.first_name <> ''
     and v_row.last_name  is not null and v_row.last_name  <> ''
     and v_row.phone      is not null and v_row.phone      <> ''
     and v_row.home_zip   is not null and v_row.home_zip   <> '' then
    update public.cleaners
    set onboarding_complete = true,
        activated_at = coalesce(activated_at, now()),
        updated_at = now()
    where public.cleaners.id = v_row.id
    returning * into v_row;
    v_was_promoted := true;
  end if;

  return query
    select v_row.id, v_row.user_id, v_row.first_name, v_row.last_name,
           v_row.email, v_row.phone, v_row.home_zip,
           v_row.onboarding_complete, v_row.approved, v_row.status,
           v_row.stripe_account_id, v_row.payouts_enabled, v_row.phone_verified,
           v_row.pay_rate_hr,
           v_was_linked, v_was_promoted;
end;
$$;

grant execute on function public.resolve_or_link_cleaner_for_user(text) to authenticated;

comment on function public.resolve_or_link_cleaner_for_user(text) is
  'Single entry point used by /cleaner/auth, /cleaner/auth/callback, /cleaner/onboarding, /cleaner/dashboard, and /cleaner/mobile-dashboard to (a) find the caller''s cleaner row, (b) auto-link an existing row by email when user_id is NULL, and (c) auto-promote onboarding_complete=true when the profile basics are filled. Fixes the onboarding redirect loop caused by cleaner rows with NULL user_id.';
