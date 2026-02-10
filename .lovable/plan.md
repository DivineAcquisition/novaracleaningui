

# Send Lead Data to New GHL Webhook (No Duplicates)

## What This Does
When a customer enters their ZIP code and contact details on the landing page (`/`) or booking page (`/book/zip`), their info gets sent to your new GoHighLevel webhook. If they've already submitted their data in the same session or their email already exists in your customers table, the webhook will NOT fire again.

## Changes

### 1. Update the GHL Lead Capture Webhook URL
Update the `GHL_LEAD_CAPTURE_WEBHOOK_URL` Supabase secret to point to the new endpoint:
`https://services.leadconnectorhq.com/hooks/fJddieqJDUjUoYAGOvbk/webhook-trigger/b5ad9435-58aa-4e0a-b0af-06c2126eca89`

### 2. Add Duplicate Detection to the Edge Function
Modify `supabase/functions/send-lead-capture-webhook/index.ts` to:
- Check the `customers` table for an existing record with the same email
- If a customer already exists, skip the webhook send and return early with a "duplicate" response
- This prevents repeat submissions from the same person across sessions/devices

### 3. Add Client-Side Duplicate Guard
Modify both `src/pages/book/Zip.tsx` and `src/pages/Index.tsx` to:
- After a successful lead capture submission, store the email in `localStorage` (key: `lead_captured_emails`)
- Before calling the webhook, check if the email is already in that list
- If already captured, skip the edge function call entirely (saves a network request)
- This handles the common case of someone going back and re-entering their info in the same browser

## Technical Details

**Edge Function Changes** (`send-lead-capture-webhook/index.ts`):
- Add Supabase client initialization using service role key
- Query `customers` table: `SELECT id FROM customers WHERE email = $email LIMIT 1`
- If found, return `{ success: true, skipped: true, reason: "duplicate" }` without calling any webhooks
- If not found, proceed with webhook sends as normal

**Client-Side Changes** (both `Zip.tsx` and `Index.tsx`):
- Before calling `send-lead-capture-webhook`, check `localStorage` for previously captured emails
- If email already captured, skip the edge function invoke
- After successful invoke, add email to the localStorage set

**No database schema changes needed** -- the existing `customers` table already stores emails from completed bookings, providing natural duplicate detection for returning customers.

