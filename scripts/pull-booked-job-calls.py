#!/usr/bin/env python3
"""Pull redacted GoHighLevel call transcripts for recent booked jobs.

Reads GHL credentials from app_secrets inside the database. Writes
tmp/booked-job-calls.json. Does not print tokens, phone numbers, or emails.
"""

from __future__ import annotations

import json
import os
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

PROJECT_REF = os.environ.get("PROJECT_REF", "sxdraeptzuamsgjcvfeg")
OUT = pathlib.Path("tmp/booked-job-calls.json")
GHL = "https://services.leadconnectorhq.com"


def db_query(token: str, sql: str) -> list:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "novara-call-pull",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read().decode()
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:300]
        raise RuntimeError(f"query failed ({err.code}): {detail}") from err
    data = json.loads(raw) if raw else []
    if isinstance(data, dict):
        data = data.get("result") or data.get("rows") or []
    return data if isinstance(data, list) else []


def redact(text: str) -> str:
    import re
    text = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[email]", text, flags=re.I)
    text = re.sub(r"\+?\d[\d\s().-]{7,}\d", "[phone]", text)
    return text[:240]


def ghl_get(token: str, path: str) -> tuple[int, object]:
    req = urllib.request.Request(
        f"{GHL}{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Version": "2021-07-28",
            "Accept": "application/json",
            "User-Agent": "novara-call-pull",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode()
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        body = err.read().decode(errors="replace")[:240]
        return err.code, {"error": body}


def sentences(payload: object) -> str:
    if isinstance(payload, list):
        parts = []
        for row in payload:
            if isinstance(row, dict) and row.get("transcript"):
                parts.append(str(row["transcript"]).strip())
        return " ".join(part for part in parts if part)
    if isinstance(payload, dict):
        if isinstance(payload.get("transcription"), list):
            return sentences(payload["transcription"])
        if isinstance(payload.get("transcript"), str):
            return payload["transcript"].strip()
        for key in ("data", "sentences", "results"):
            if key in payload:
                text = sentences(payload[key])
                if text:
                    return text
    return ""


def message_list(body: object) -> list:
    if not isinstance(body, dict):
        return []
    messages = body.get("messages")
    if isinstance(messages, dict):
        messages = messages.get("messages")
    return messages if isinstance(messages, list) else []


def is_call(message: dict) -> bool:
    kind = str(message.get("messageType") or message.get("type") or "").upper()
    return "CALL" in kind or kind in {"1", "TYPE_1"}


def main() -> None:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit("SUPABASE_ACCESS_TOKEN is empty")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    report: dict = {"bookings": [], "transcripts": [], "notes": []}

    secrets = db_query(
        token,
        """
        select key, length(btrim(coalesce(value, ''))) as chars
        from public.app_secrets
        where key ilike '%GHL%' or key ilike '%HIGHLEVEL%' or key ilike '%PIT%'
        order by key
        """,
    )
    report["secret_keys"] = secrets

    values = {
        row["key"]: row.get("value") or ""
        for row in db_query(
            token,
            """
            select key, value
            from public.app_secrets
            where key in ('GHL_PIT_TOKEN', 'GHL_LOCATION_ID', 'GHL_API_KEY', 'GHL_PRIVATE_TOKEN')
            """,
        )
    }
    ghl_token = str(values.get("GHL_PIT_TOKEN") or values.get("GHL_API_KEY") or values.get("GHL_PRIVATE_TOKEN") or "").strip()
    location_id = str(values.get("GHL_LOCATION_ID") or "").strip()

    counts = db_query(token, "select status, count(*)::int as n from public.bookings group by status order by n desc")
    report["booking_counts"] = counts

    jobs = db_query(
        token,
        """
        select id, first_name, service_type, service_date::text as service_date, status, email, phone, city
        from public.bookings
        where status not in ('pending_payment', 'cancelled', 'canceled')
        order by service_date desc nulls last, created_at desc
        limit 8
        """,
    )
    report["bookings"] = [
        {
            "first_name": row.get("first_name"),
            "service_type": row.get("service_type"),
            "service_date": row.get("service_date"),
            "status": row.get("status"),
            "city": row.get("city"),
        }
        for row in jobs
    ]

    events = db_query(
        token,
        """
        select coalesce(event_type, '(none)') as event_type, count(*)::int as n
        from public.ghl_webhook_log
        group by 1
        order by n desc
        limit 20
        """,
    )
    report["webhook_events"] = events

    if not ghl_token or not location_id:
        report["notes"].append("GoHighLevel token or location id is not stored in app_secrets.")
    else:
        location_status, location_body = ghl_get(ghl_token, f"/locations/{urllib.parse.quote(location_id)}")
        report["ghl_location_status"] = location_status
        if location_status >= 400:
            report["notes"].append(redact(str(location_body)[:240]))
        for row in jobs:
            email = str(row.get("email") or "").strip()
            digits = "".join(ch for ch in str(row.get("phone") or "") if ch.isdigit())
            phone = f"+1{digits[-10:]}" if len(digits) >= 10 else ""
            attempts = []
            if email:
                attempts.append(("email", {"locationId": location_id, "email": email}))
            if phone:
                attempts.append(("phone", {"locationId": location_id, "phone": phone}))
            status = 0
            looked: object = {}
            contact = {}
            for label, params in attempts:
                status, looked = ghl_get(ghl_token, f"/contacts/lookup?{urllib.parse.urlencode(params)}")
                found = {}
                if isinstance(looked, dict):
                    if isinstance(looked.get("contact"), dict):
                        found = looked["contact"]
                    elif isinstance(looked.get("contacts"), list) and looked["contacts"] and isinstance(looked["contacts"][0], dict):
                        found = looked["contacts"][0]
                    elif looked.get("id"):
                        found = looked
                if found.get("id"):
                    contact = found
                    break
                query = email if label == "email" else phone
                status, looked = ghl_get(
                    ghl_token,
                    f"/contacts/?locationId={urllib.parse.quote(location_id)}&query={urllib.parse.quote(query)}",
                )
                if isinstance(looked, dict) and isinstance(looked.get("contacts"), list) and looked["contacts"]:
                    first = looked["contacts"][0]
                    if isinstance(first, dict) and first.get("id"):
                        contact = first
                        break
            contact_id = str((contact or {}).get("id") or "").strip()
            lookup_error = None
            if not contact_id and isinstance(looked, dict):
                lookup_error = redact(str(looked.get("error") or looked.get("message") or looked) )
            entry = {
                "first_name": row.get("first_name"),
                "service_type": row.get("service_type"),
                "service_date": row.get("service_date"),
                "status": row.get("status"),
                "city": row.get("city"),
                "lookup_status": status,
                "lookup_error": lookup_error,
                "calls": [],
            }
            if not contact_id:
                entry["calls"].append({"note": "no GoHighLevel contact", "error": lookup_error})
                report["transcripts"].append(entry)
                continue
            status, convos = ghl_get(
                ghl_token,
                f"/conversations/search?locationId={urllib.parse.quote(location_id)}&contactId={urllib.parse.quote(contact_id)}&limit=10",
            )
            conversations = convos.get("conversations") if isinstance(convos, dict) else []
            call_messages = []
            for convo in (conversations or [])[:3]:
                convo_id = str(convo.get("id") or "")
                if not convo_id:
                    continue
                _, body = ghl_get(ghl_token, f"/conversations/{urllib.parse.quote(convo_id)}/messages?limit=100")
                for message in message_list(body):
                    if isinstance(message, dict) and is_call(message):
                        call_messages.append(message)
            for message in call_messages[:8]:
                message_id = str(message.get("id") or "")
                text = ""
                if message_id:
                    _, payload = ghl_get(
                        ghl_token,
                        f"/conversations/locations/{urllib.parse.quote(location_id)}/messages/{urllib.parse.quote(message_id)}/transcription",
                    )
                    text = sentences(payload)
                    meta = message.get("meta") if isinstance(message.get("meta"), dict) else {}
                call = meta.get("call") if isinstance(meta.get("call"), dict) else {}
                entry["calls"].append({
                    "at": message.get("dateAdded") or message.get("createdAt"),
                    "direction": message.get("direction"),
                    "duration": call.get("duration"),
                    "transcript": text or None,
                    "body": (str(message.get("body") or "").strip() or None),
                })
                time.sleep(0.2)
            if not entry["calls"]:
                entry["calls"].append({"note": "contact found, no call messages"})
            report["transcripts"].append(entry)
            time.sleep(0.2)

    OUT.write_text(json.dumps(report, indent=2))
    print(
        f"jobs={len(report['bookings'])} transcripts={len(report['transcripts'])} "
        f"ghl={'yes' if ghl_token and location_id else 'no'} events={len(report.get('webhook_events') or [])}"
    )


if __name__ == "__main__":
    main()
