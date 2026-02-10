

# Add New GHL Booking Webhook

## What This Does
Adds your new GoHighLevel webhook endpoint as an additional destination for booking data. Every time a booking is confirmed, the same rich payload (customer info, service details, financials, scheduling, etc.) will also be sent to this new endpoint.

## Changes

### 1. Store the New Webhook URL as a Secret
Add a new Supabase secret called `GHL_BOOKING_WEBHOOK_URL` with value:
`https://services.leadconnectorhq.com/hooks/fJddieqJDUjUoYAGOvbk/webhook-trigger/e4e949e8-eee9-4683-99f6-b58c7057e7f7`

**Note:** The `GHL_BOOKING_WEBHOOK_URL` secret already exists. It will be updated to this new URL.

### 2. No Code Changes Needed
The `send-zapier-webhook` edge function already reads `GHL_BOOKING_WEBHOOK_URL` (line 18) and includes it in the webhook targets list (line 451). The existing code will automatically send booking data to this new URL once the secret is updated.

## What Gets Sent
The full booking payload including:
- Customer info (name, email, phone, address)
- Service details (type, frequency, sq ft, bedrooms, bathrooms, add-ons)
- Scheduling (date, time, arrival window, estimated duration)
- Financial data (price, deposit, discounts, payment status)
- Team/cleaner assignment details
- Status tracking and referral codes

## Technical Details
- **File:** `supabase/functions/send-zapier-webhook/index.ts` -- no changes needed
- **Secret:** `GHL_BOOKING_WEBHOOK_URL` -- update value to new endpoint
- The function sends to all configured webhooks in parallel with retry logic (3 attempts with exponential backoff)
- Failed sends are logged to the `webhook_failures` table for monitoring

