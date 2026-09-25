#!/usr/bin/env python3
"""Remove the mistaken sample contractor created during the onboarding test.

Targets one plus-address only. Refuses to touch contact@novaracleaning.com.
Does not print tokens, TINs, or verification codes.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

PROJECT_REF = os.environ.get("PROJECT_REF", "sxdraeptzuamsgjcvfeg")
EMAIL = "contact+onboarding-sample@novaracleaning.com"
PHONE = "+18447352070"


def query(token: str, sql: str) -> object:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "novara-sample-cleanup",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read().decode()
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:500]
        raise SystemExit(f"query failed ({err.code}): {detail}") from err
    return json.loads(raw) if raw else None


def rows(result: object) -> list[dict]:
    if isinstance(result, list):
        return [row for row in result if isinstance(row, dict)]
    return []


def ident(name: str) -> str:
    if not name.replace("_", "").isalnum():
        raise SystemExit(f"unexpected identifier: {name}")
    return name


def main() -> None:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit("SUPABASE_ACCESS_TOKEN is empty")
    if EMAIL == "contact@novaracleaning.com":
        raise SystemExit("refusing to delete the admin login")

    found = rows(query(
        token,
        f"""
        select u.id as user_id, c.id as cleaner_id
        from auth.users u
        full join public.cleaners c
          on c.user_id = u.id or lower(c.email) = lower(u.email)
        where lower(u.email) = '{EMAIL}'
           or lower(c.email) = '{EMAIL}'
        """,
    ))
    user_ids = sorted({row["user_id"] for row in found if row.get("user_id")})
    cleaner_ids = sorted({row["cleaner_id"] for row in found if row.get("cleaner_id")})
    print(f"matched users={len(user_ids)} cleaners={len(cleaner_ids)}")
    if len(user_ids) > 1 or len(cleaner_ids) > 1:
        raise SystemExit("refusing to delete more than one sample account")

    ghl_contacts: list[str] = []
    if cleaner_ids:
        cid = cleaner_ids[0]
        events = rows(query(
            token,
            f"""
            select data->>'contact_id' as contact_id
            from public.events
            where cleaner_id = '{cid}'
              and event_type = 'cleaner.ghl_synced'
              and created_at > now() - interval '6 hours'
            """,
        ))
        ghl_contacts = sorted({row["contact_id"] for row in events if row.get("contact_id")})

    ghl_note = "no recent ghl sync"
    if ghl_contacts:
        secrets = rows(query(
            token,
            "select key, value from public.app_secrets where key in ('GHL_PIT_TOKEN')",
        ))
        pit = next((row.get("value") or "" for row in secrets if row.get("key") == "GHL_PIT_TOKEN"), "")
        if not pit:
            ghl_note = "ghl token missing; left the contact"
        else:
            ghl_note = tidy_ghl(pit, ghl_contacts[0])

    deleted_children = 0
    if cleaner_ids:
        cid = cleaner_ids[0]
        fks = rows(query(
            token,
            """
            select n.nspname as schema, c.relname as table_name, a.attname as column_name
            from pg_constraint con
            join pg_class c on c.oid = con.conrelid
            join pg_namespace n on n.oid = c.relnamespace
            join pg_attribute a on a.attrelid = c.oid and a.attnum = any (con.conkey)
            join pg_class ref on ref.oid = con.confrelid
            join pg_namespace rn on rn.oid = ref.relnamespace
            where con.contype = 'f'
              and rn.nspname = 'public'
              and ref.relname = 'cleaners'
              and array_length(con.conkey, 1) = 1
            """,
        ))
        for fk in fks:
            schema, table, column = ident(fk["schema"]), ident(fk["table_name"]), ident(fk["column_name"])
            if schema not in ("public",):
                continue
            before = rows(query(token, f"select count(*)::int as n from {schema}.{table} where {column} = '{cid}'"))
            count = int(before[0]["n"]) if before else 0
            if count:
                query(token, f"delete from {schema}.{table} where {column} = '{cid}'")
                deleted_children += count
        query(token, f"delete from public.cleaners where id = '{cid}' and lower(email) = '{EMAIL}'")

    if user_ids:
        uid = user_ids[0]
        query(token, f"delete from public.user_roles where user_id = '{uid}'")
        query(
            token,
            f"""
            delete from auth.users u
            where u.id = '{uid}'
              and lower(u.email) = '{EMAIL}'
            """,
        )

    query(
        token,
        f"""
        delete from public.cleaner_verification_codes
        where phone = '{PHONE}'
          and created_at > now() - interval '6 hours'
        """,
    )

    left = rows(query(
        token,
        f"""
        select
          (select count(*)::int from auth.users where lower(email) = '{EMAIL}') as users,
          (select count(*)::int from public.cleaners where lower(email) = '{EMAIL}') as cleaners
        """,
    ))
    print(json.dumps({
        "deleted_child_rows": deleted_children,
        "remaining": left[0] if left else None,
        "ghl": ghl_note,
    }))
    if left and (int(left[0]["users"]) or int(left[0]["cleaners"])):
        raise SystemExit("sample account is still present")


def tidy_ghl(pit: str, contact_id: str) -> str:
    if not contact_id.replace("-", "").isalnum():
        return "skipped ghl id"
    headers = {
        "Authorization": f"Bearer {pit}",
        "Version": "2021-07-28",
        "Accept": "application/json",
    }
    req = urllib.request.Request(
        f"https://services.leadconnectorhq.com/contacts/{contact_id}",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            payload = json.loads(res.read().decode())
    except urllib.error.HTTPError as err:
        return f"ghl lookup failed ({err.code}); left the contact"
    contact = payload.get("contact") if isinstance(payload, dict) else None
    if not isinstance(contact, dict):
        return "ghl contact missing; left it"
    email = str(contact.get("email") or "").strip().lower()
    added = str(contact.get("dateAdded") or "")
    if email != EMAIL:
        return "left existing ghl contact"
    if not added.startswith("2026-09-25"):
        return "left older ghl contact that now has the sample email"
    delete_req = urllib.request.Request(
        f"https://services.leadconnectorhq.com/contacts/{contact_id}",
        headers=headers,
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(delete_req, timeout=30):
            return "deleted new ghl contact"
    except urllib.error.HTTPError as err:
        return f"ghl delete failed ({err.code}); left the contact"


if __name__ == "__main__":
    main()
