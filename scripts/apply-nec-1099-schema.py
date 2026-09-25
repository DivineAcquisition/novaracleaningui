#!/usr/bin/env python3
"""Apply the December 2026 1099 tables on the Novara Supabase project.

Uses the Supabase management API (SUPABASE_ACCESS_TOKEN). The SQL file is
idempotent. Statement splitting keeps dollar-quoted function bodies intact.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

PROJECT_REF = os.environ.get("PROJECT_REF", "sxdraeptzuamsgjcvfeg")
ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_SQL = [
    ROOT / "supabase/migrations/20260922203000_nec_1099_copy_b_c.sql",
    ROOT / "supabase/migrations/20260925010000_onboarding_w9.sql",
]


def split_sql(sql: str) -> list[str]:
    statements: list[str] = []
    buf: list[str] = []
    i = 0
    dollar: str | None = None
    line_comment = False
    block_comment = False
    quote = False
    while i < len(sql):
        if line_comment:
            buf.append(sql[i])
            if sql[i] == "\n":
                line_comment = False
            i += 1
            continue
        if block_comment:
            if sql.startswith("*/", i):
                buf.append("*/")
                i += 2
                block_comment = False
                continue
            buf.append(sql[i])
            i += 1
            continue
        if quote:
            buf.append(sql[i])
            if sql.startswith("''", i):
                buf.append("'")
                i += 2
                continue
            if sql[i] == "'":
                quote = False
            i += 1
            continue
        if dollar is not None:
            if sql.startswith(dollar, i):
                buf.append(dollar)
                i += len(dollar)
                dollar = None
                continue
            buf.append(sql[i])
            i += 1
            continue
        if sql.startswith("--", i):
            line_comment = True
            buf.append("--")
            i += 2
            continue
        if sql.startswith("/*", i):
            block_comment = True
            buf.append("/*")
            i += 2
            continue
        if sql[i] == "'":
            quote = True
            buf.append(sql[i])
            i += 1
            continue
        if sql[i] == "$":
            j = i + 1
            while j < len(sql) and (sql[j].isalnum() or sql[j] == "_"):
                j += 1
            if j < len(sql) and sql[j] == "$":
                dollar = sql[i : j + 1]
                buf.append(dollar)
                i = j + 1
                continue
        if sql[i] == ";":
            statement = "".join(buf).strip()
            if statement:
                statements.append(statement)
            buf = []
            i += 1
            continue
        buf.append(sql[i])
        i += 1
    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def query(token: str, sql: str) -> object:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "novara-schema-apply",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read().decode()
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:500]
        raise SystemExit(f"schema query failed ({err.code}): {detail}") from err
    return json.loads(raw) if raw else None


def sql_paths() -> list[pathlib.Path]:
    raw = os.environ.get("SQL_PATH", "").strip()
    if raw:
        return [pathlib.Path(part.strip()) for part in raw.split(",") if part.strip()]
    return DEFAULT_SQL


def apply_file(token: str, path: pathlib.Path) -> None:
    statements = split_sql(path.read_text())
    if "nec_1099_copy_b_c" in path.name and len(statements) < 8:
        raise SystemExit(f"expected the 1099 migration to split into several statements, got {len(statements)}")
    if "onboarding_w9" in path.name and "w9_status" not in path.read_text():
        raise SystemExit("the onboarding migration does not mention w9_status")
    print(f"applying {len(statements)} statements from {path.name}")
    for index, statement in enumerate(statements, start=1):
        first = " ".join(statement.split()[:6])
        try:
            query(token, statement)
        except SystemExit as err:
            if statement.upper().startswith("NOTIFY"):
                print(f"skip notify: {err}")
                continue
            raise SystemExit(f"{path.name} statement {index} failed ({first}): {err}") from err
        print(f"ok {path.name} {index}: {first}")


def main() -> None:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit("SUPABASE_ACCESS_TOKEN is empty")
    paths = sql_paths()
    if not paths:
        raise SystemExit("no SQL files to apply")
    for path in paths:
        if not path.is_file():
            raise SystemExit(f"missing SQL file: {path}")
        apply_file(token, path)
    rows = query(
        token,
        "select to_regclass('public.cleaner_w9') as w9, to_regclass('public.nec_1099_forms') as forms",
    )
    print(json.dumps(rows))
    encoded = json.dumps(rows)
    if "cleaner_w9" not in encoded or "nec_1099_forms" not in encoded:
        raise SystemExit("tables were not created")
    if any("onboarding_w9" in path.name for path in paths):
        defs = query(
            token,
            """
            select p.proname as name, pg_get_functiondef(p.oid) as def
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('cleaner_ready_for_first_job', 'mint_cleaner_setup_token')
            """,
        )
        encoded_defs = json.dumps(defs)
        print("functions mention w9_status:", "w9_status" in encoded_defs)
        if encoded_defs.count("w9_status") < 2:
            raise SystemExit("mint or the first-job gate is still missing w9_status")


if __name__ == "__main__":
    main()
