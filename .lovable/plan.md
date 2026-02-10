
# Meta Pixel Funnel Tracking Events

Add Meta Pixel conversion events at key points in the booking flow to track the full funnel for Meta Ads optimization.

## What This Does

Tracks three key user actions so Meta can optimize your ad delivery:

1. **ViewContent** -- When a user selects a service type and sees pricing (Offer page)
2. **InitiateCheckout** -- When a user reaches the checkout/payment page
3. **Purchase** -- When a booking is confirmed (Success page)

## Where Events Fire

```text
Zip Code --> Home Size --> Offer Page -----------> Checkout -----------> Success
                          (ViewContent)     (InitiateCheckout)       (Purchase)
```

## Implementation Steps

### 1. Add TypeScript declaration for `fbq`

Create a small type declaration file so TypeScript recognizes the global `fbq` function without errors.

### 2. Create a reusable Meta Pixel helper

Create `src/lib/meta-pixel.ts` with wrapper functions:
- `trackViewContent(value, contentName)` -- fires ViewContent
- `trackInitiateCheckout(value)` -- fires InitiateCheckout
- `trackPurchase(value, serviceType, frequency, zoneId)` -- fires Purchase

Each function safely checks if `fbq` exists before calling it.

### 3. Fire ViewContent on the Offer page

In `src/pages/book/Offer.tsx`, call `trackViewContent` when the user selects a service type and the estimated price is calculated.

### 4. Fire InitiateCheckout on the Checkout page

In `src/pages/book/Checkout.tsx`, call `trackInitiateCheckout` when the page loads and payment is initialized (client secret is ready).

### 5. Fire Purchase on the Success page

In `src/pages/book/Success.tsx`, call `trackPurchase` when payment is verified and the booking is confirmed.

## Technical Details

- The base pixel code (ID: `1641726577181415`) is already in `index.html` and fires `PageView` on every page load
- All new events will include `value` and `currency: 'USD'` for Meta's value optimization
- Price values will be passed in dollars (not cents)
- The helper functions will gracefully no-op if `fbq` is not loaded (e.g., ad blockers)

## Files Changed

| File | Change |
|------|--------|
| `src/types/meta-pixel.d.ts` | New -- TypeScript declaration for `fbq` global |
| `src/lib/meta-pixel.ts` | New -- Helper functions for pixel events |
| `src/pages/book/Offer.tsx` | Add ViewContent event when service is selected |
| `src/pages/book/Checkout.tsx` | Add InitiateCheckout event on page load |
| `src/pages/book/Success.tsx` | Add Purchase event on booking confirmation |
