
# Fix: Stripe Payment Form Not Loading

## Root Cause

The Stripe payment form fails to load because the `create-payment-intent` edge function returns a **409 error** instead of the `clientSecret` needed to render the form.

Here is what happens step-by-step:

```text
1. Client calls create-payment-intent
2. Edge function calculates pricing (OK)
3. Edge function creates Stripe PaymentIntent (OK)
4. Edge function calls reserve_time_slot() RPC --> FAILS with PGRST203
5. Function returns 409 "This time slot just filled up" --> Client never gets clientSecret
6. Stripe form never renders
```

The database error (`PGRST203`) occurs because there are **two versions** of the `reserve_time_slot` function with different parameter types:

- `reserve_time_slot(_date date, _start_time text, _end_time text)`
- `reserve_time_slot(_date date, _start_time time without time zone, _end_time time without time zone)`

When the edge function calls the RPC with string values like `"09:00"`, PostgreSQL cannot decide which function to use and throws:

> "Could not choose the best candidate function between: public.reserve_time_slot(...text...) and public.reserve_time_slot(...time without time zone...)"

The same duplication exists for `release_time_slot`.

## Fix

### Step 1: Drop the duplicate database functions

Run a migration to drop the `time without time zone` versions, keeping only the `text` versions which the edge functions already use:

```sql
DROP FUNCTION IF EXISTS public.reserve_time_slot(date, time without time zone, time without time zone);
DROP FUNCTION IF EXISTS public.release_time_slot(date, time without time zone);
```

### Step 2: Align Stripe API version in create-payment-intent

The `create-payment-intent` function uses Stripe API version `2023-10-16` while `verify-payment` and `create-checkout` use `2025-08-27.basil`. Update `create-payment-intent` to use the same version for consistency:

In `supabase/functions/create-payment-intent/index.ts`, change:
```
apiVersion: "2023-10-16"
```
to:
```
apiVersion: "2025-08-27.basil"
```

## Files Changed

| File | Change |
|------|--------|
| Database migration | Drop duplicate `reserve_time_slot` and `release_time_slot` functions with `time` type params |
| `supabase/functions/create-payment-intent/index.ts` | Update Stripe API version to `2025-08-27.basil` |

## Expected Result

After these changes:
1. The `reserve_time_slot` RPC call will resolve to the single remaining `text`-parameter function
2. The time slot reservation will succeed
3. The edge function will return the `clientSecret`
4. The Stripe payment form will render in the checkout page
