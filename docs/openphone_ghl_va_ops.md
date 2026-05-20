# OpenPhone + GHL + VA Ops — operator setup

End-to-end speed-to-lead workflow for Novara:

```
FB Lead Ad / LSA / Website
            │
            ▼
   lead-intake (edge fn)
            │
   ┌────────┴───────────────────────┐
   ▼                                 ▼
public.leads (canonical row)   GHL (contact + open opportunity)
   │                                 │
   │   round-robin pick from         │
   │   va_assignments                │
   │                                 ▼
   ▼                       2-minute "calling you" SMS (GHL)
assigned_va_user_id        via send-ghl-sms
            │
            ▼ (VA clicks contact in GHL)
       OpenPhone dialer
            │
            ▼ (call ends)
   openphone-webhook (edge fn)
            │
   ┌────────┴────────┐
   ▼                ▼
phone_calls row    GHL contact note + tag
            │
            ▼
  escalate-stale-leads (cron, every minute)
   • flags any HOT lead with no last_call_at after 10m
   • sends follow-up SMS to customer
   • posts ⚠️ note + 'lead-escalated' tag in GHL
```

## What was deployed

| Edge function | Slug | Auth | Purpose |
|---|---|---|---|
| `lead-intake` | `lead-intake` | none (webhook) | New lead → leads table + GHL contact/opportunity + VA assignment + speed-to-lead SMS |
| `openphone-webhook` | `openphone-webhook` | HMAC verify | Persist OpenPhone calls + AI summaries; mirror into GHL notes; update lead state |
| `escalate-stale-leads` | `escalate-stale-leads` | none (cron) | Flag HOT leads not called within 10 minutes |
| `send-ghl-sms` | `send-ghl-sms` | none | Send SMS via GHL Conversations API (used as the SMS transport everywhere now) |

## Database additions

- `leads.{lead_score, assigned_va_user_id, call_attempts, last_call_at, last_call_outcome, next_action_at, do_not_call, escalated_at, ghl_contact_id, ghl_opportunity_id, openphone_contact_id, speed_to_lead_sms_sent_at, escalation_sms_sent_at}`
- `customers.{lead_score, do_not_call, last_called_at, last_call_outcome, last_booking_at}`
- `phone_calls` — full call ledger from OpenPhone (with AI summary, recording URL, disposition)
- `va_assignments` — round-robin queue (set `is_active`, `on_shift` per VA)
- `app_role` enum gained `va` and `csr` values
- pg_cron: `escalate-stale-leads-every-minute` job pings the escalation function once per minute

## Operator setup (one-time)

### 1. Add your VAs

For each VA who will receive lead assignments, create a Supabase auth user (they sign in via `/auth`) then register them in the round-robin queue:

```sql
INSERT INTO public.va_assignments (va_user_id, display_name, is_active, on_shift)
VALUES ('<supabase-auth-user-id>', 'Anna (VA)', true, true);

-- and add the role
INSERT INTO public.user_roles (user_id, role) VALUES ('<supabase-auth-user-id>', 'va');
```

Toggle `on_shift=false` when a VA is off-shift; the round-robin will skip them.

### 2. Wire OpenPhone (when the account is provisioned)

a. In Supabase, populate the secret:

```sql
UPDATE public.app_secrets SET value = '<your OpenPhone webhook secret>' WHERE key = 'OPENPHONE_WEBHOOK_SECRET';
UPDATE public.app_secrets SET value = '<your OpenPhone API key>'      WHERE key = 'OPENPHONE_API_KEY';
```

b. In OpenPhone → Settings → Webhooks → **New webhook**:

  - URL: `https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/openphone-webhook`
  - Events: `call.completed`, `call.recording.completed`, `call.summary.completed`, `message.received`, `message.sent`
  - Copy the **signing secret** OpenPhone shows → paste into the `OPENPHONE_WEBHOOK_SECRET` row above.

c. Install the **OpenPhone ↔ GHL** integration from the OpenPhone marketplace and link it to your GHL location so calls are click-to-dial from inside GHL.

### 3. Wire FB Lead Ads / LSA / website forms to `lead-intake`

Three paths, pick one per source:

- **GHL workflow path (recommended)**: in GHL, create a workflow with trigger "New Lead — Contact Created" → action "Webhook → Custom Webhook":

  - URL: `https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/lead-intake`
  - Method: `POST`
  - Headers: `apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>`
  - Body (JSON):

```json
{
  "source": "{{contact.source}}",
  "firstName": "{{contact.first_name}}",
  "lastName": "{{contact.last_name}}",
  "email": "{{contact.email}}",
  "phone": "{{contact.phone}}",
  "zipCode": "{{contact.postal_code}}",
  "city": "{{contact.city}}",
  "state": "{{contact.state}}",
  "address": "{{contact.address1}}",
  "leadScore": "hot",
  "utmSource": "{{contact.utm_source}}",
  "utmMedium": "{{contact.utm_medium}}",
  "utmCampaign": "{{contact.utm_campaign}}"
}
```

- **Direct FB Lead Ads → us**: in Meta Business Suite, point the lead webhook at the same URL with a similar body.

- **Website form → us**: have the form POST directly to `https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/lead-intake` with the same shape (no auth header needed, the function is public to receive leads).

### 4. Optional: senior CSR escalation alert

If you want senior CSRs to be SMS'd whenever a lead is escalated (separate from the customer-facing SMS the cron already sends), append your CSR phone numbers as a comma-separated list to a new secret:

```sql
INSERT INTO public.app_secrets (key, value)
VALUES ('CSR_ESCALATION_PHONES', '+13013468452,+1XXXXXXXXXX')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

(Then ping me to wire the cron payload into `send-ghl-sms` for those numbers.)

## Smoke test

```bash
ANON='<anon JWT from .env>'

# 1. Fire a fake hot lead
curl -X POST 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/lead-intake' \
  -H 'Content-Type: application/json' \
  -H "apikey: $ANON" \
  -d '{
    "source": "fb_lead_ads",
    "firstName": "Smoke",
    "lastName": "Test",
    "phone": "+13013468452",
    "email": "smoke-test@novara-internal.test",
    "zipCode": "20816",
    "city": "Bethesda",
    "state": "MD",
    "serviceType": "standard",
    "leadScore": "hot"
  }'
# → returns { leadId, ghlContactId, ghlOpportunityId, assignedVaUserId, ... }

# 2. Verify the lead row landed
psql -c "SELECT id, first_name, lead_score, status, assigned_va_user_id, ghl_contact_id, speed_to_lead_sms_sent_at FROM leads ORDER BY created_at DESC LIMIT 1;"

# 3. Simulate a finished call (without OpenPhone signature — works when
#    OPENPHONE_WEBHOOK_SECRET is empty in app_secrets, as it is by default)
curl -X POST 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/openphone-webhook' \
  -H 'Content-Type: application/json' \
  -H "apikey: $ANON" \
  -d '{
    "type": "call.completed",
    "data": {
      "id": "op_test_call_1",
      "direction": "outbound",
      "from": "+18334432004",
      "to": ["+13013468452"],
      "status": "completed",
      "startedAt": "2026-05-20T20:00:00Z",
      "completedAt": "2026-05-20T20:04:32Z",
      "duration": 272,
      "tags": ["booked"],
      "summary": "Customer confirmed booking for Sat 10 AM Standard Clean."
    }
  }'

# 4. Verify it landed
psql -c "SELECT openphone_call_id, disposition, ai_summary, ghl_contact_id FROM phone_calls ORDER BY created_at DESC LIMIT 1;"
```

## Disposition mapping

| OpenPhone tag / AI summary clue | Stored `disposition` | Lead status |
|---|---|---|
| "booked", "scheduled", "confirmed booking" | `booked` | `booked` |
| "voicemail", "vm", "left voicemail" | `vm_left` | (no change) |
| "no answer", "missed" | `no_answer` | (no change) |
| "callback", "call back" | `callback` | `callback` |
| "not interested" | `not_interested` | `not_interested` |
| "dnc", "do not call" | `dnc` | `dnc`, `do_not_call=true` |
| everything else | `completed` | (no change) |

VAs just need to drop the right tag on the OpenPhone call before they hang up; the rest is automatic.

## What's next (not built yet, but plumbing is ready)

1. **OpenPhone outbound power-dialer queue** in the admin UI — read from `leads` where `assigned_va_user_id = <me>` and `last_call_at IS NULL`, click-to-dial via the OpenPhone Chrome extension.
2. **Old-lead recycling sequences** — a daily cron that bumps cold leads back to `lead_score=warm` if they had a booking within the last 12 months and don't have an active membership, so VAs can re-engage them for recurring.
3. **AI call quality scoring** — feed OpenPhone AI summaries through GPT to grade VA performance (talked too much, missed objection, didn't ask for the close, etc.).
