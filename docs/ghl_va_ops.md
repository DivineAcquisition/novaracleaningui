# GHL + VA Ops — operator setup

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
            ▼
  escalate-stale-leads (cron, every minute)
   • flags any HOT lead with no last_call_at after 10m
   • sends follow-up SMS to customer
   • posts ⚠️ note + 'lead-escalated' tag in GHL
```

VAs dial from inside GHL, and GHL is the record of the conversation. There is
no separate telephony integration: OpenPhone was wired up speculatively in May
2026, never adopted, and removed in July 2026. If a dialer is ever added, note
what its webhook has to do that GHL doesn't already — `leads.last_call_at` and
`last_call_outcome` are the fields the escalation cron reads, and something has
to set them.

## What is deployed

| Edge function | Slug | Auth | Purpose |
|---|---|---|---|
| `lead-intake` | `lead-intake` | none (webhook) | New lead → leads table + GHL contact/opportunity + VA assignment + speed-to-lead SMS |
| `escalate-stale-leads` | `escalate-stale-leads` | none (cron) | Flag HOT leads not called within 10 minutes |
| `send-ghl-sms` | `send-ghl-sms` | none | Send SMS via GHL Conversations API (the SMS transport everywhere now) |

## Database

- `leads.{lead_score, assigned_va_user_id, call_attempts, last_call_at, last_call_outcome, next_action_at, do_not_call, escalated_at, ghl_contact_id, ghl_opportunity_id, speed_to_lead_sms_sent_at, escalation_sms_sent_at}`
- `customers.{lead_score, do_not_call, last_called_at, last_call_outcome, last_booking_at}`
- `phone_calls` — provider-agnostic call ledger. Nothing writes to it since the
  OpenPhone webhook was removed; VA call metrics come from the GHL
  conversations API instead. Kept because it is the shape any future dialer
  would land in.
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

### 2. Wire FB Lead Ads / LSA / website forms to `lead-intake`

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

### 3. Optional: senior CSR escalation alert

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

# 3. Verify escalation fires for an uncalled hot lead (last_call_at stays NULL)
psql -c "SELECT id, lead_score, escalated_at, escalation_sms_sent_at FROM leads WHERE escalated_at IS NOT NULL ORDER BY escalated_at DESC LIMIT 5;"
```

## What's next (not built yet)

1. **Old-lead recycling sequences** — a daily cron that bumps cold leads back to `lead_score=warm` if they had a booking within the last 12 months and don't have an active membership, so VAs can re-engage them for recurring.
2. **AI call quality scoring** — needs a telephony provider that produces call summaries first; nothing produces them today.
