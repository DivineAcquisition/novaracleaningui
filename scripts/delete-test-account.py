#!/usr/bin/env python3
"""Delete the asannie74@gmail.com test account and the rows tied to it.

Refuses to run if that login is an admin, or if the contractor has completed
jobs, bookings, payroll, or payments. Prints counts only — never tokens or tax ids.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

PROJECT_REF = os.environ.get("PROJECT_REF", "sxdraeptzuamsgjcvfeg")
EMAIL = "asannie74@gmail.com"
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
DANGER = ("booking", "payment", "invoice", "payroll", "payout", "stripe", "ledger", "charge", "refund", "job")


def redact(text: str) -> str:
    return re.sub(r"[a-f0-9]{20,}", "[redacted]", text)


def query(token: str, sql: str) -> list[dict]:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
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
        detail = redact(err.read().decode(errors="replace")[:500])
        raise SystemExit(f"query failed ({err.code}): {detail}") from err
    parsed = json.loads(raw) if raw else []
    if isinstance(parsed, list):
        return [row for row in parsed if isinstance(row, dict)]
    return []


def ident(value: str) -> str:
    name = value.split(".")[-1].strip('"')
    if not IDENT.match(name):
        raise SystemExit(f"unsafe identifier: {value}")
    return name


def main() -> None:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit("SUPABASE_ACCESS_TOKEN is empty")

    cleaners = query(
        token,
        f"""
        select id::text, user_id::text, status,
               coalesce(completed_bookings, 0)::int as completed_bookings,
               (stripe_account_id is not null) as has_stripe,
               setup_token
        from public.cleaners
        where lower(email) = '{EMAIL}'
        """,
    )
    users = query(
        token,
        f"""
        select u.id::text,
               exists (
                 select 1 from public.user_roles ur
                 where ur.user_id = u.id and ur.role::text = 'admin'
               ) as is_admin
        from auth.users u
        where lower(u.email) = '{EMAIL}'
        """,
    )
    if any(row.get("is_admin") for row in users):
        raise SystemExit("refusing to delete an admin login")

    cleaner_ids = [row["id"] for row in cleaners]
    user_ids = [row["id"] for row in users]
    for row in cleaners:
        if row.get("user_id") and row["user_id"] not in user_ids:
            user_ids.append(row["user_id"])
    if any(int(row.get("completed_bookings") or 0) > 0 for row in cleaners):
        raise SystemExit("refusing to delete a contractor with completed jobs")

    fks = query(
        token,
        """
        select c.conrelid::regclass::text as tbl,
               a.attname as col,
               c.confdeltype as del
        from pg_constraint c
        join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.confrelid = 'public.cleaners'::regclass
          and c.contype = 'f'
        """,
    )
    refs: list[dict] = []
    blockers: list[str] = []
    for fk in fks:
        table = ident(str(fk["tbl"]))
        column = ident(str(fk["col"]))
        total = 0
        for cleaner_id in cleaner_ids:
            counted = query(
                token,
                f"select count(*)::int as n from public.{table} where {column} = '{cleaner_id}'",
            )
            total += int((counted[0] if counted else {}).get("n") or 0)
        refs.append({"table": table, "column": column, "del": fk.get("del"), "n": total})
        if total and any(fragment in table for fragment in DANGER):
            blockers.append(f"{table}.{column}={total}")

    email_cols = query(
        token,
        """
        select c.table_schema as schema, c.table_name as tbl, c.column_name as col
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
        where t.table_type = 'BASE TABLE'
          and c.table_schema = 'public'
          and c.data_type in ('text', 'character varying')
          and c.column_name ilike '%email%'
        """,
    )
    email_hits: list[dict] = []
    for col in email_cols:
        schema = ident(str(col["schema"]))
        table = ident(str(col["tbl"]))
        column = ident(str(col["col"]))
        counted = query(
            token,
            f"select count(*)::int as n from {schema}.{table} where lower({column}) = '{EMAIL}'",
        )
        n = int((counted[0] if counted else {}).get("n") or 0)
        if n:
            email_hits.append({"table": table, "column": column, "n": n})
            if any(fragment in table for fragment in DANGER):
                blockers.append(f"{table}.{column}={n}")

    if user_ids:
        auth_fks = query(
            token,
            """
            select n.nspname as schema,
                   c.conrelid::regclass::text as tbl,
                   a.attname as col
            from pg_constraint c
            join pg_class rel on rel.oid = c.conrelid
            join pg_namespace n on n.oid = rel.relnamespace
            join pg_attribute a
              on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.confrelid = 'auth.users'::regclass
              and c.contype = 'f'
              and c.confdeltype in ('a', 'r')
            """,
        )
        id_list = ", ".join(f"'{user_id}'" for user_id in user_ids)
        for fk in auth_fks:
            schema = ident(str(fk["schema"]))
            table = ident(str(fk["tbl"]))
            column = ident(str(fk["col"]))
            if column in ("created_by", "updated_by", "uploaded_by"):
                continue
            counted = query(
                token,
                f"select count(*)::int as n from {schema}.{table} where {column}::text in ({id_list})",
            )
            n = int((counted[0] if counted else {}).get("n") or 0)
            if n and any(fragment in table for fragment in DANGER):
                blockers.append(f"{schema}.{table}.{column}={n}")

    if blockers:
        print(json.dumps({"aborted": True, "blockers": blockers, "refs": refs, "email_hits": email_hits}))
        raise SystemExit("refusing to delete because related job or payment rows exist")

    deleted_sms = 0
    for row in cleaners:
        setup_token = str(row.get("setup_token") or "")
        if len(setup_token) < 16:
            continue
        removed = query(
            token,
            "delete from public.sms_logs where message like '%"
            + setup_token
            + "%' returning id",
        )
        deleted_sms += len(removed)

    deleted_events = query(
        token,
        f"""
        delete from public.events
        where data::text ilike '%{EMAIL}%'
           or summary ilike '%{EMAIL}%'
        returning id
        """,
    )

    deleted_refs: dict[str, int] = {}
    for ref in refs:
        if ref["del"] not in ("a", "r") or not ref["n"]:
            continue
        removed = 0
        for cleaner_id in cleaner_ids:
            gone = query(
                token,
                f"delete from public.{ref['table']} where {ref['column']} = '{cleaner_id}' returning 1",
            )
            removed += len(gone)
        deleted_refs[ref["table"]] = removed

    deleted_email: dict[str, int] = {}
    for hit in email_hits:
        if hit["table"] == "cleaners":
            continue
        gone = query(
            token,
            f"delete from public.{hit['table']} where lower({hit['column']}) = '{EMAIL}' returning 1",
        )
        deleted_email[hit["table"]] = len(gone)

    deleted_cleaners = query(
        token,
        f"delete from public.cleaners where lower(email) = '{EMAIL}' returning id",
    )

    deleted_auth_children: dict[str, int] = {}
    if user_ids:
        auth_fks = query(
            token,
            """
            select n.nspname as schema,
                   c.conrelid::regclass::text as tbl,
                   a.attname as col,
                   c.confdeltype as del
            from pg_constraint c
            join pg_class rel on rel.oid = c.conrelid
            join pg_namespace n on n.oid = rel.relnamespace
            join pg_attribute a
              on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.confrelid = 'auth.users'::regclass
              and c.contype = 'f'
              and c.confdeltype in ('a', 'r')
            """,
        )
        for fk in auth_fks:
            schema = ident(str(fk["schema"]))
            table = ident(str(fk["tbl"]))
            column = ident(str(fk["col"]))
            removed = 0
            for user_id in user_ids:
                if column in ("created_by", "updated_by", "uploaded_by"):
                    query(
                        token,
                        f"update {schema}.{table} set {column} = null where {column} = '{user_id}'",
                    )
                else:
                    gone = query(
                        token,
                        f"delete from {schema}.{table} where {column} = '{user_id}' returning 1",
                    )
                    removed += len(gone)
            if removed:
                deleted_auth_children[f"{schema}.{table}"] = removed

        storage = 0
        for user_id in user_ids:
            gone = query(
                token,
                f"delete from storage.objects where owner::text = '{user_id}' returning id",
            )
            storage += len(gone)
        if storage:
            deleted_auth_children["storage.objects"] = storage

    if user_ids:
        id_list = ", ".join(f"'{user_id}'" for user_id in user_ids)
        removed_roles = query(
            token,
            f"delete from public.user_roles where user_id::text in ({id_list}) returning id",
        )
        if removed_roles:
            deleted_auth_children["public.user_roles"] = len(removed_roles)

    deleted_users = query(
        token,
        f"delete from auth.users where lower(email) = '{EMAIL}' returning id",
    )

    remaining_cleaners = query(
        token,
        f"select count(*)::int as n from public.cleaners where lower(email) = '{EMAIL}'",
    )
    remaining_users = query(
        token,
        f"select count(*)::int as n from auth.users where lower(email) = '{EMAIL}'",
    )
    remaining_applicants = query(
        token,
        f"select count(*)::int as n from public.cleaner_applicants where lower(email) = '{EMAIL}'",
    )

    summary = {
        "email": EMAIL,
        "cleaners_found": len(cleaners),
        "had_stripe": any(bool(row.get("has_stripe")) for row in cleaners),
        "deleted_cleaners": len(deleted_cleaners),
        "deleted_users": len(deleted_users),
        "deleted_sms": deleted_sms,
        "deleted_events": len(deleted_events),
        "deleted_refs": deleted_refs,
        "deleted_email_rows": deleted_email,
        "deleted_auth_children": deleted_auth_children,
        "remaining_cleaners": int((remaining_cleaners[0] if remaining_cleaners else {}).get("n") or 0),
        "remaining_users": int((remaining_users[0] if remaining_users else {}).get("n") or 0),
        "remaining_applicants": int((remaining_applicants[0] if remaining_applicants else {}).get("n") or 0),
    }
    print(json.dumps(summary))
    if summary["remaining_cleaners"] or summary["remaining_users"] or summary["remaining_applicants"]:
        raise SystemExit("test account rows are still present")


if __name__ == "__main__":
    main()
