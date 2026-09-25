#!/usr/bin/env python3
"""Delete the asannie74@gmail.com test account and the rows tied to it.

One database call does the work, so the management API is not rate-limited.
Refuses to run if that login is an admin, or if the contractor has completed
jobs, bookings, payroll, or payments. Prints counts only.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request

PROJECT_REF = os.environ.get("PROJECT_REF", "sxdraeptzuamsgjcvfeg")
EMAIL = "asannie74@gmail.com"

WIPE_SQL = r"""
create or replace function public._tmp_delete_test_account()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, storage
as $fn$
declare
  v_email text := 'asannie74@gmail.com';
  v_cleaner_ids uuid[] := '{}';
  v_user_ids uuid[] := '{}';
  v_blockers jsonb := '[]'::jsonb;
  v_deleted_refs jsonb := '{}'::jsonb;
  v_deleted_email jsonb := '{}'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_deleted_sms int := 0;
  v_deleted_events int := 0;
  v_deleted_cleaners int := 0;
  v_deleted_users int := 0;
  v_has_stripe boolean := false;
  v_completed boolean := false;
  v_cleaners_found int := 0;
  r record;
  n int := 0;
  v_token text;
begin
  select coalesce(array_agg(id), '{}'),
         count(*)::int,
         coalesce(bool_or(coalesce(completed_bookings, 0) > 0), false),
         coalesce(bool_or(stripe_account_id is not null), false)
    into v_cleaner_ids, v_cleaners_found, v_completed, v_has_stripe
  from public.cleaners
  where lower(email) = v_email;

  if v_completed then
    return jsonb_build_object('aborted', true, 'reason', 'completed_jobs');
  end if;

  select coalesce(array_agg(distinct id), '{}')
    into v_user_ids
  from (
    select id from auth.users where lower(email) = v_email
    union
    select user_id from public.cleaners
    where lower(email) = v_email and user_id is not null
  ) ids;

  if exists (
    select 1 from public.user_roles ur
    where ur.user_id = any(v_user_ids) and ur.role::text = 'admin'
  ) then
    return jsonb_build_object('aborted', true, 'reason', 'admin');
  end if;

  if cardinality(v_cleaner_ids) > 0 then
    for r in
      select c.conrelid::regclass as rel,
             c.conrelid::regclass::text as relname,
             a.attname as col,
             c.confdeltype as del
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.confrelid = 'public.cleaners'::regclass
        and c.contype = 'f'
    loop
      execute format('select count(*)::int from %s where %I = any($1)', r.rel, r.col)
        into n using v_cleaner_ids;
      if n > 0 and r.relname ~* 'booking|payment|invoice|payroll|payout|stripe|ledger|charge|refund|job' then
        v_blockers := v_blockers || jsonb_build_array(r.relname || '.' || r.col || '=' || n);
      end if;
    end loop;
  end if;

  for r in
    select c.table_schema as schema,
           c.table_name as tbl,
           c.column_name as col
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where t.table_type = 'BASE TABLE'
      and c.table_schema = 'public'
      and c.data_type in ('text', 'character varying')
      and c.column_name ilike '%email%'
  loop
    execute format(
      'select count(*)::int from %I.%I where lower(%I) = $1',
      r.schema, r.tbl, r.col
    ) into n using v_email;
    if n > 0 and r.tbl ~* 'booking|payment|invoice|payroll|payout|stripe|ledger|charge|refund|job' then
      v_blockers := v_blockers || jsonb_build_array(r.tbl || '.' || r.col || '=' || n);
    end if;
  end loop;

  if cardinality(v_user_ids) > 0 then
    for r in
      select nsp.nspname as schema,
             rel.relname as tbl,
             a.attname as col
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.confrelid = 'auth.users'::regclass
        and c.contype = 'f'
        and c.confdeltype in ('a', 'r')
        and a.attname not in ('created_by', 'updated_by', 'uploaded_by')
    loop
      execute format(
        'select count(*)::int from %I.%I where %I = any($1)',
        r.schema, r.tbl, r.col
      ) into n using v_user_ids;
      if n > 0 and r.tbl ~* 'booking|payment|invoice|payroll|payout|stripe|ledger|charge|refund|job' then
        v_blockers := v_blockers || jsonb_build_array(r.schema || '.' || r.tbl || '.' || r.col || '=' || n);
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object('aborted', true, 'reason', 'related_work', 'blockers', v_blockers);
  end if;

  for v_token in
    select setup_token from public.cleaners
    where lower(email) = v_email and coalesce(setup_token, '') <> ''
  loop
    delete from public.sms_logs where position(v_token in message) > 0;
    get diagnostics n = row_count;
    v_deleted_sms := v_deleted_sms + n;
  end loop;

  delete from public.sms_logs where message ilike '%' || v_email || '%';
  get diagnostics n = row_count;
  v_deleted_sms := v_deleted_sms + n;

  delete from public.events
  where data::text ilike '%' || v_email || '%'
     or summary ilike '%' || v_email || '%';
  get diagnostics v_deleted_events = row_count;

  if cardinality(v_cleaner_ids) > 0 then
    for r in
      select c.conrelid::regclass as rel,
             c.conrelid::regclass::text as relname,
             a.attname as col,
             c.confdeltype as del
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.confrelid = 'public.cleaners'::regclass
        and c.contype = 'f'
        and c.confdeltype in ('a', 'r')
    loop
      execute format('delete from %s where %I = any($1)', r.rel, r.col) using v_cleaner_ids;
      get diagnostics n = row_count;
      if n > 0 then
        v_deleted_refs := v_deleted_refs || jsonb_build_object(r.relname, n);
      end if;
    end loop;
  end if;

  for r in
    select c.table_schema as schema,
           c.table_name as tbl,
           c.column_name as col
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where t.table_type = 'BASE TABLE'
      and c.table_schema = 'public'
      and c.data_type in ('text', 'character varying')
      and c.column_name ilike '%email%'
      and c.table_name <> 'cleaners'
  loop
    begin
      execute format('delete from %I.%I where lower(%I) = $1', r.schema, r.tbl, r.col) using v_email;
      get diagnostics n = row_count;
      if n > 0 then
        v_deleted_email := v_deleted_email || jsonb_build_object(r.tbl, n);
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'table', r.tbl,
        'error', left(sqlerrm, 160)
      ));
    end;
  end loop;

  delete from public.cleaners where lower(email) = v_email;
  get diagnostics v_deleted_cleaners = row_count;

  if cardinality(v_user_ids) > 0 then
    for r in
      select nsp.nspname as schema,
             rel.relname as tbl,
             a.attname as col
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.confrelid = 'auth.users'::regclass
        and c.contype = 'f'
        and c.confdeltype in ('a', 'r')
    loop
      begin
        if r.col in ('created_by', 'updated_by', 'uploaded_by') then
          execute format(
            'update %I.%I set %I = null where %I = any($1)',
            r.schema, r.tbl, r.col, r.col
          ) using v_user_ids;
        else
          execute format(
            'delete from %I.%I where %I = any($1)',
            r.schema, r.tbl, r.col
          ) using v_user_ids;
        end if;
      exception when others then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'table', r.schema || '.' || r.tbl,
          'error', left(sqlerrm, 160)
        ));
      end;
    end loop;

    delete from public.user_roles where user_id = any(v_user_ids);
    begin
      delete from storage.objects where owner = any(v_user_ids);
    exception when others then
      -- Storage blocks direct deletes. The contractor files live on cleaner rows.
      null;
    end;
  end if;

  delete from auth.users where lower(email) = v_email;
  get diagnostics v_deleted_users = row_count;

  return jsonb_build_object(
    'email', v_email,
    'cleaners_found', v_cleaners_found,
    'had_stripe', v_has_stripe,
    'deleted_cleaners', v_deleted_cleaners,
    'deleted_users', v_deleted_users,
    'deleted_sms', v_deleted_sms,
    'deleted_events', v_deleted_events,
    'deleted_refs', v_deleted_refs,
    'deleted_email_rows', v_deleted_email,
    'errors', v_errors,
    'remaining_cleaners', (select count(*)::int from public.cleaners where lower(email) = v_email),
    'remaining_users', (select count(*)::int from auth.users where lower(email) = v_email),
    'remaining_applicants', (select count(*)::int from public.cleaner_applicants where lower(email) = v_email)
  );
end
$fn$;
"""


def redact(text: str) -> str:
    return re.sub(r"[a-f0-9]{20,}", "[redacted]", text)


def query(token: str, sql: str) -> list[dict]:
    body = json.dumps({"query": sql}).encode()
    delay = 2
    last_detail = ""
    for _ in range(6):
        req = urllib.request.Request(
            f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
            data=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "novara-delete-test-account",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                raw = res.read().decode()
        except urllib.error.HTTPError as err:
            last_detail = redact(err.read().decode(errors="replace")[:500])
            if err.code == 429:
                time.sleep(delay)
                delay *= 2
                continue
            raise SystemExit(f"query failed ({err.code}): {last_detail}") from err
        parsed = json.loads(raw) if raw else []
        if isinstance(parsed, list):
            return [row for row in parsed if isinstance(row, dict)]
        return []
    raise SystemExit(f"query failed (429): {last_detail}")


def main() -> None:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit("SUPABASE_ACCESS_TOKEN is empty")

    try:
        query(token, WIPE_SQL)
        rows = query(token, "select public._tmp_delete_test_account() as result")
    finally:
        query(token, "drop function if exists public._tmp_delete_test_account()")

    result = (rows[0] if rows else {}).get("result") or {}
    if isinstance(result, str):
        result = json.loads(result)
    print(json.dumps(result))
    if result.get("aborted"):
        raise SystemExit(f"delete aborted: {result.get('reason')}")
    if result.get("errors"):
        raise SystemExit("some related rows could not be deleted")
    if result.get("remaining_cleaners") or result.get("remaining_users") or result.get("remaining_applicants"):
        raise SystemExit("test account rows are still present")


if __name__ == "__main__":
    main()
