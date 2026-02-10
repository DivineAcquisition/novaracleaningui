

# Fix: Stripe Payment Form Blocked by Slot Reservation

## Problem

The `create-payment-intent` edge function creates the Stripe PaymentIntent successfully but then checks slot availability. If the slot is full or the reservation fails for any reason, it returns a 409 error and **throws away the clientSecret** -- so the payment form never loads.

The slot for `2026-02-17 13:00` is currently at 5/5 capacity (inflated by all the retry attempts), which is why every attempt fails.

## Root Cause

Lines 390-401 of `create-payment-intent/index.ts` treat a failed slot reservation as a hard blocker, returning 409 and discarding the already-created PaymentIntent.

## Fix (Two Parts)

### Part 1: Make slot reservation non-blocking

Change the reservation logic so that if it fails, the function **logs a warning but still returns the clientSecret**. The slot reservation becomes a best-effort optimization, not a gate.

In `supabase/functions/create-payment-intent/index.ts`, replace the 409 error return with a warning log:

```text
Before:
  if (reserveError || !reserved) {
    return 409 error  <-- BLOCKS payment form
  }

After:
  if (reserveError || !reserved) {
    logStep("Warning: slot reservation failed, continuing with payment")
    // Continue -- payment form still loads
  }
```

### Part 2: Reset the inflated slot counter

The `2026-02-17 13:00` slot has `current_bookings: 5` from all the failed retries. Reset it so real customers can book that time:

```sql
UPDATE availability_slots
SET current_bookings = 0
WHERE service_date = '2026-02-17'
  AND start_time = '13:00:00';
```

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/create-payment-intent/index.ts` | Make slot reservation non-blocking (warning instead of 409) |
| Database (data fix) | Reset `current_bookings` on the inflated slot |

## Expected Result

- The payment form will always load as long as the Stripe PaymentIntent is created successfully
- Slot availability is still tracked but does not block checkout
- The corrupted slot counter is fixed

