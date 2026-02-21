

# Simplify Offer Page: Show Only $99 First Clean + Membership

## What Changes

Remove the **Deep Clean** card from the `/book/offer` page so customers only see two options:

1. **$99 First Clean** (promo card, amber theme)
2. **Novara Glow Membership** (green theme, "Most Popular")

Also remove the Deep Clean "What's Included?" modal since it will no longer be accessible.

## File to Modify

| File | Change |
|---|---|
| `src/pages/book/Offer.tsx` | Remove the Deep Clean card (Card A), remove `handleSelectDeepClean`, remove `showDeepCleanModal` state and its Dialog, remove the `DEEP_CLEAN_FEATURES` constant. Change the offers grid from 2-column to single-column since only the Membership card remains there. |

## What Stays Untouched

- All pricing logic and `prices.deepClean` calculations remain (no core pricing removed)
- The Membership card, promo card, schedule picker, modals for membership -- all unchanged
- `brand-config.ts` and `pricing-system.ts` untouched
- Deep clean is still available through the Sales Tool for admin use

