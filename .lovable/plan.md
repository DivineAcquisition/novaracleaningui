

# Add Real Stripe Invoice & Payment Links to Webhook Payload

## Problem
- The current "Invoice URL" in the webhook is a fabricated URL (`https://invoice.stripe.com/i/...`) that doesn't work for customers.
- The actual `hosted_invoice_url` from Stripe (the real payment link for remaining balance) is never saved -- it's only logged.
- For customers who paid in full, there's no receipt link included in the payload.

## Changes

### 1. Add `hosted_invoice_url` Column to Bookings Table
New migration to add a column storing the real Stripe invoice payment link.

```sql
ALTER TABLE bookings ADD COLUMN hosted_invoice_url text;
```

### 2. Update `stripe-webhook` Edge Function
After finalizing the invoice, save the `hosted_invoice_url` alongside the `stripe_invoice_id`:

```typescript
await supabase
  .from('bookings')
  .update({ 
    stripe_invoice_id: invoice.id,
    hosted_invoice_url: finalizedInvoice.hosted_invoice_url 
  })
  .eq('id', booking.id);
```

### 3. Update `send-zapier-webhook` Edge Function
Replace the fake invoice URL with the real one, and add a receipt link for paid-in-full customers:

- **"Invoice URL"**: Use `booking.hosted_invoice_url` (the real Stripe-hosted payment page for remaining balance)
- **"Payment Receipt URL"**: For paid-in-full bookings, use the Stripe receipt URL constructed from the `payment_intent_id` by fetching the charge's `receipt_url` via Stripe API

Specifically:
- If `payment_option === 'deposit'` and `hosted_invoice_url` exists: include it as the "Invoice URL" (this is the link for paying the remaining balance)
- If `payment_option === 'full'` and `payment_intent_id` exists: fetch the PaymentIntent from Stripe to get the charge's `receipt_url` and include it as "Payment Receipt URL"

### 4. Updated Webhook Payload Fields

| Field | When | Value |
|-------|------|-------|
| Invoice URL | Deposit customers with remaining balance | Real Stripe hosted invoice link (clickable payment page) |
| Payment Receipt URL | Paid-in-full customers | Stripe receipt URL from the charge |
| Invoice Status | Always | Based on Stripe invoice status or "Paid in Full" |

## Files Modified
- **New migration** -- Add `hosted_invoice_url` column to `bookings`
- **`supabase/functions/stripe-webhook/index.ts`** -- Save `hosted_invoice_url` on invoice creation
- **`supabase/functions/send-zapier-webhook/index.ts`** -- Use real URLs, add Stripe API call for receipt URL

## Notes
- The Stripe API call in the webhook function uses the existing `STRIPE_SECRET_KEY` secret (already configured)
- For existing bookings that already have a `stripe_invoice_id` but no `hosted_invoice_url`, the field will be empty until the next invoice is created
