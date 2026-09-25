#!/usr/bin/env python3
"""Point the setup profile at asannie74@gmail.com and text the existing link.

Does not mint a new token. The profile stays pending and is not offered jobs.
The token is not printed when the text is sent.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

PROJECT_REF = os.environ.get("PROJECT_REF", "sxdraeptzuamsgjcvfeg")
OLD_EMAIL = "contact@novaracleaning.com"
EMAIL = "asannie74@gmail.com"
PHONE = "+18447352070"
SUPABASE_URL = f"https://{PROJECT_REF}.supabase.co"


def query(token: str, sql: str) -> object:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "novara-setup-link",
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


def anon_key(token: str) -> str:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/api-keys",
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": "novara-setup-link",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        payload = json.loads(res.read().decode())
    keys = payload if isinstance(payload, list) else payload.get("keys") or []
    for item in keys:
        name = str(item.get("name") or item.get("id") or "").lower()
        if "anon" in name and "service" not in name:
            value = item.get("api_key") or item.get("apiKey") or ""
            if value:
                return str(value)
    raise SystemExit("anon key was not in the project key list")


def post_function(name: str, anon: str, body: dict) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"{SUPABASE_URL}/functions/v1/{name}",
        data=json.dumps(body).encode(),
        headers={
            "apikey": anon,
            "Authorization": f"Bearer {anon}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode()
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        raw = err.read().decode(errors="replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"error": raw[:300]}
        return err.code, parsed if isinstance(parsed, dict) else {"error": str(parsed)[:300]}


def main() -> None:
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        raise SystemExit("SUPABASE_ACCESS_TOKEN is empty")

    found = rows(query(
        token,
        f"""
        select id, lower(email) as email, setup_token
        from public.cleaners
        where lower(email) in ('{OLD_EMAIL}', '{EMAIL}')
        """,
    ))
    by_email = {row["email"]: row for row in found}
    target = by_email.get(EMAIL) or by_email.get(OLD_EMAIL)
    if not target:
        raise SystemExit("no setup profile to retarget")
    if EMAIL in by_email and OLD_EMAIL in by_email and by_email[EMAIL]["id"] != by_email[OLD_EMAIL]["id"]:
        raise SystemExit("both emails already have cleaner rows")

    cleaner_id = target["id"]
    query(
        token,
        f"""
        update public.cleaners
        set email = '{EMAIL}',
            phone = '{PHONE}',
            user_id = null,
            status = 'pending',
            approved = false,
            available_for_bookings = false,
            onboarding_complete = false,
            updated_at = now()
        where id = '{cleaner_id}'
          and lower(email) in ('{OLD_EMAIL}', '{EMAIL}')
        """,
    )

    current = rows(query(
        token,
        f"select setup_token from public.cleaners where id = '{cleaner_id}' and lower(email) = '{EMAIL}'",
    ))
    setup_token = str((current[0] if current else {}).get("setup_token") or "")
    if len(setup_token) < 16:
        raise SystemExit("setup token missing after email change")
    setup_url = f"https://contractor.novaracleaning.com/cleaner/setup/{setup_token}"

    anon = anon_key(token)
    email_status, email_body = post_function("send-cleaner-email", anon, {
        "type": "setup_request",
        "email": EMAIL,
        "data": {
            "firstName": "Malik",
            "lastName": "Sannie",
            "email": EMAIL,
            "setupUrl": setup_url,
            "loginUrl": setup_url,
            "needsAgreement": True,
            "needsPhone": True,
            "needsSupplies": True,
            "needsDressCode": True,
            "needsJobDay": True,
            "needsW9": True,
            "needsTraining": True,
            "needsStripe": True,
        },
    })
    sms_text = (
        "Hi Malik! Novara Cleaning — finish account setup "
        "(sign the agreement, verify your phone, check off your supplies, "
        "read Day To Day Job Operations, agree to the dress code, submit your W-9, "
        "set up Stripe payouts and watch the training videos) here: "
        f"{setup_url} It only takes a few minutes. Questions? Just reply."
    )
    sms_status, sms_body = post_function("send-sms-notification", anon, {
        "toPhone": PHONE,
        "message": sms_text,
        "type": "confirmation",
    })
    if sms_status >= 300 or sms_body.get("error"):
        ghl_status, ghl_body = post_function("send-ghl-sms", anon, {
            "phone": PHONE,
            "firstName": "Malik",
            "message": sms_text,
            "type": "confirmation",
        })
        if ghl_status < 300 and not ghl_body.get("error"):
            sms_status, sms_body = ghl_status, ghl_body
        else:
            sms_body = {
                "error": "send failed",
                "telnyx": str(sms_body.get("error") or sms_body)[:240],
                "ghl": str(ghl_body.get("body") or ghl_body.get("error") or "")[:240],
            }

    emailed = email_status < 300 and not email_body.get("error")
    sms_sent = sms_status < 300 and not sms_body.get("error")
    try:
        with urllib.request.urlopen(setup_url, timeout=30) as res:
            page_status = res.status
    except urllib.error.HTTPError as err:
        page_status = err.code

    summary = {
        "email": EMAIL,
        "emailed": emailed,
        "email_status": email_status,
        "email_error": None if emailed else str(email_body.get("error") or "")[:240],
        "sms_sent": sms_sent,
        "sms_status": sms_status,
        "sms_error": None if sms_sent else str(sms_body.get("error") or sms_body)[:240],
        "setup_page": page_status,
    }
    if not sms_sent:
        summary["setup_url"] = setup_url
    print(json.dumps(summary))
    if not sms_sent or page_status >= 400:
        raise SystemExit("setup text was not sent")


if __name__ == "__main__":
    main()
