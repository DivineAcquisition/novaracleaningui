

# Add Real-Time Lead Alert Emails

## What This Does

Every time a new lead fills out the post-ZIP contact form (on `/book/zip` or the landing page `/`), an instant email notification will be sent to **contact@novaracleaning.com** with the lead's details (name, email, phone, ZIP, city/state, source).

## How It Works

The `send-lead-capture-webhook` edge function already runs on every new lead submission. We simply add a Resend email send to that function -- right after the duplicate check passes and before the external webhook calls.

## Changes

### 1. Update `supabase/functions/send-lead-capture-webhook/index.ts`

After the duplicate detection block (which returns early for existing customers), add:

- Import Resend
- Send a notification email to `contact@novaracleaning.com` with subject like "New Lead: John S. -- 21230"
- Email body: clean HTML table with First Name, Last Name, Email, Phone, ZIP, City, State, Source, Landing Page, and timestamp
- Fire-and-forget (don't block the webhook sends if email fails)

No other files need to change. The existing client-side code in `Zip.tsx` and `Index.tsx` already calls this function on every new lead.

## Technical Details

```text
send-lead-capture-webhook flow (updated):

  1. Receive lead data
  2. Duplicate check against customers table
  3. [NEW] Send alert email to contact@novaracleaning.com via Resend
  4. Send to GHL + Zapier webhooks (unchanged)
  5. Return response
```

The RESEND_API_KEY secret is already configured. No new secrets needed.

### Files Changed

| File | Action |
|---|---|
| `supabase/functions/send-lead-capture-webhook/index.ts` | Edit -- add Resend email alert |

