

# Add $99 First Clean Promotional Pricing

## Overview

Add a toggleable promotional tier that overrides the standard clean price to a flat $99 for first-time customers. This is purely additive -- no existing pricing logic is modified. The promo can be turned on/off from a single constant.

## Key Rules Enforced

- First-time customers only (checked via `customerStatus.isNew`)
- Standard clean only -- auto-disabled if service type is "deep" or "moveInOut"
- No $75 first-clean surcharge applied (it's a standard clean, not deep)
- No add-ons included at promo price (add-ons charge separately on top)
- After promo clean, customer reverts to regular pricing
- Toggle on/off via a single boolean constant

## Technical Details

### 1. Add Promo Config to `src/config/brand-config.ts`

Add a new section below `ACTIVE_PROMOS`:

```typescript
export const FIRST_CLEAN_PROMO = {
  enabled: true,               // Toggle on/off
  price: 99,                   // Flat $99
  label: "$99 First Clean",
  description: "Standard clean only. First-time customers. One per household.",
  serviceTypeRestriction: "standard",  // Only standard clean
};
```

### 2. Add Promo Toggle + Auto-Discount in `src/pages/admin/SalesTool.tsx`

- Add state: `const [applyFirstCleanPromo, setApplyFirstCleanPromo] = useState(false)`
- In the "Booking Configuration" card, add a checkbox (only visible when `FIRST_CLEAN_PROMO.enabled` is true, customer is new, and service type is "standard")
- When toggled ON: auto-calculate the discount as `(regularPrice - 99)` and apply it as the `customDiscount`
- When toggled OFF: reset `customDiscount` to 0
- Auto-disable the checkbox if user switches service type away from "standard"
- Show an info banner explaining the promo rules when active

### 3. Update `handleCreateBooking` in `SalesTool.tsx`

- Include `first_clean_promo: applyFirstCleanPromo` in the GHL webhook payload
- Add `"$99 First Clean Promo"` to `team_notes` when promo is active so cleaners and admin see it

### 4. Update `LiveQuotePanel` Display

- When `firstCleanPromo` prop is true, show a highlighted "$99 First Clean" badge and strike through the regular price
- Pass a new optional `firstCleanPromo` boolean prop

### 5. Update `IntakePricingSidebar` Display

- Same visual treatment: show promo price with strikethrough on original

## Files to Modify

| File | Change |
|---|---|
| `src/config/brand-config.ts` | Add `FIRST_CLEAN_PROMO` config object |
| `src/pages/admin/SalesTool.tsx` | Add promo checkbox, auto-discount logic, webhook payload update |
| `src/components/sales/LiveQuotePanel.tsx` | Add `firstCleanPromo` prop, show promo badge |
| `src/components/admin/IntakePricingSidebar.tsx` | Add `firstCleanPromo` prop, show promo badge |

## How to Disable Later

Set `FIRST_CLEAN_PROMO.enabled = false` in `brand-config.ts`. The checkbox disappears from the form, and all pricing reverts to normal. No other files need changes.

