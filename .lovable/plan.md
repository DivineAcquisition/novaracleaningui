
# Fix: Race Condition Causing Missing Emails and Webhooks After Booking

## Problem Identified

Malik Sannie's booking (`d7bfdbc2`) on Feb 11 was confirmed but received **no confirmation email, no job dispatch, and no Zapier webhook**. The `confirmation_email_sent` flag is `false` and `job_id` is `null`.

### Root Cause: Race Condition Between `verify-payment` and `stripe-webhook`

There are three independent systems that can confirm a booking:

```text
Customer pays -> Success page loads
                    |
                    +--> verify-payment (edge function)
                    |       Confirms booking status
                    |       Sends email
                    |       Does NOT dispatch job or send webhooks
                    |
                    +--> stripe-webhook (from Stripe servers)
                            Checks status -> already "confirmed"
                            SKIPS EVERYTHING (idempotency guard)
                            No email, no dispatch, no Zapier, no calendar
```

When `verify-payment` wins the race (which happened here), the `stripe-webhook` sees the booking is already confirmed and skips all downstream actions. But `verify-payment` doesn't trigger dispatch, Zapier, Google Calendar, or referral generation -- those only exist in `stripe-webhook`.

## Solution

### Strategy: Make `stripe-webhook` the single source of truth for post-payment actions

Instead of having the idempotency check skip everything, split it into two concerns:
1. **Status update** -- skip if already confirmed (keep idempotency)
2. **Downstream actions** -- always run if payment succeeded, using their own idempotency flags

### Changes

#### 1. Update `supabase/functions/stripe-webhook/index.ts`

Restructure the `payment_intent.succeeded` handler so downstream actions run even if the booking was already confirmed by `verify-payment`:

- Keep the status update idempotent (don't re-confirm)
- Move email sending, auto-dispatch, Zapier webhook, Google Calendar, and referral generation **outside** the idempotency guard
- Each action already has its own idempotency check:
  - Email: checks `confirmation_email_sent` flag
  - Dispatch: checks `job_id` existence
  - Zapier: fire-and-forget (safe to re-send)
  - Calendar: checks `google_calendar_event_id`

The key change is replacing the early `break` at line 93 with a flag that skips only the status update but continues processing downstream actions.

#### 2. Update `supabase/functions/verify-payment/index.ts`

Simplify this function to **only** verify payment status and update booking status. Remove the email sending logic (lines 218-283) since `stripe-webhook` will reliably handle all downstream actions. This eliminates the competing email sender.

Also remove the credit deduction logic (lines 99-132) since `stripe-webhook` already handles this with the same optimistic locking pattern.

#### 3. Update `src/pages/book/Success.tsx`

Remove the client-side `sendConfirmationEmail` effect (lines 224-362). This is a third competing email sender that adds complexity. The `stripe-webhook` will handle all email sending server-side, which is more reliable than client-side triggers that depend on the user staying on the page.

Keep the `verify-payment` call for UI feedback (showing the user their payment status), but it no longer triggers side effects.

#### 4. Immediate Fix for Malik's Booking

Run the downstream actions manually for the missed booking by invoking the edge functions directly:
- Call `send-booking-email` with the booking data
- Call `auto-dispatch-booking` with the booking ID
- Call `send-zapier-webhook` with the booking ID

## File Changes Summary

| File | Action | What Changes |
|---|---|---|
| `supabase/functions/stripe-webhook/index.ts` | Edit | Remove early `break` on confirmed status; run downstream actions with individual idempotency checks |
| `supabase/functions/verify-payment/index.ts` | Edit | Remove email sending and credit deduction; keep only status verification |
| `src/pages/book/Success.tsx` | Edit | Remove client-side email sending effect |

## After the Fix

```text
Customer pays -> Success page loads
                    |
                    +--> verify-payment
                    |       Updates status to "confirmed" (if not already)
                    |       Returns status to UI for display
                    |       NO side effects
                    |
                    +--> stripe-webhook
                            Updates status to "confirmed" (skipped if already done)
                            ALWAYS runs downstream actions:
                              - Send confirmation email (if not already sent)
                              - Auto-dispatch job (if no job_id yet)
                              - Send Zapier webhook
                              - Create Google Calendar event
                              - Generate referral code
```

This ensures that even if `verify-payment` confirms the booking first, the webhook still fires all the important downstream actions.
