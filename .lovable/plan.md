

# Fix Referral Links + Clean Up Bookings

## 1. Delete All Bookings

Remove all existing booking records from the database. These include test bookings and bookings without valid Stripe purchases.

## 2. Fix Referral Link URLs

The referral link currently generates as `/book?ref=CODE` which doesn't match any route. It needs to be `/book/zip?ref=CODE`.

**Files to fix:**
- `src/components/ReferralSection.tsx` (line 47) -- change `/book?ref=` to `/book/zip?ref=`
- `supabase/functions/generate-booking-referral-code/index.ts` (line 83) -- fix the hardcoded URL to use `/book/zip?ref=`

## 3. Capture the `?ref=` Parameter on the Zip Page

The Zip page (`src/pages/book/Zip.tsx`) currently has **no code** to read the `ref` query parameter from the URL. When a referred customer lands on `/book/zip?ref=ZUP4HKWX`, the referral code is silently ignored.

**Fix:** Add `useSearchParams` to the Zip page to:
- Read the `ref` parameter on load
- Store it in the BookingContext via `updateBookingData({ referralCode })`
- Auto-apply it later at checkout

## 4. Show a Visual Referral Banner

When a customer arrives via a referral link, show a friendly banner on the Zip page so they know they're getting a discount. Something like:

```
----------------------------------------------
| Gift icon  You were referred! $50 off your |
|            first cleaning is waiting.       |
----------------------------------------------
```

This banner appears only when a valid `?ref=` parameter is present.

## 5. Auto-Apply Referral at Checkout

In `src/pages/book/Checkout.tsx`, check if `bookingData.referralCode` is already set (from the Zip page capture) and auto-apply it instead of requiring the customer to manually type it.

## Files Changed

| File | Change |
|------|--------|
| Database (data operation) | Delete all rows from `bookings` table |
| `src/components/ReferralSection.tsx` | Fix URL from `/book?ref=` to `/book/zip?ref=` |
| `supabase/functions/generate-booking-referral-code/index.ts` | Fix hardcoded referral URL path |
| `src/pages/book/Zip.tsx` | Read `?ref=` param, store in BookingContext, show referral banner |
| `src/pages/book/Checkout.tsx` | Auto-apply referral code from BookingContext on load |

## Expected Result

- All old bookings are removed
- Referral links point to the correct `/book/zip?ref=CODE` URL
- Customers landing via referral link see a friendly "$50 off" banner
- The referral code auto-applies at checkout without manual entry
