

# Rebuild Membership Setup with V2 Pricing

## The Core Challenge

The old membership model used 3 fixed prices ($189/$289/$389). The V2 pricing model has membership prices that **vary by home size** -- for example, Monthly ranges from $129/mo (0-999 sqft) to $459/mo (4,501-5,000 sqft). This fundamentally changes how memberships work in Stripe and in the UI.

## V2 Membership Pricing (Zone B)

| Home Size | Monthly (1x) | Bi-Weekly (2x) | Weekly (4x) |
|---|---|---|---|
| 0-999 | $129/mo | $199/mo | $349/mo |
| 1,000-1,500 | $159/mo | $249/mo | $449/mo |
| 1,501-2,000 | $199/mo | $319/mo | $569/mo |
| 2,001-2,500 | $229/mo | $369/mo | $659/mo |
| 2,501-3,000 | $279/mo | $449/mo | $799/mo |
| 3,001-3,500 | $319/mo | $499/mo | $899/mo |
| 3,501-4,000 | $369/mo | $579/mo | $1,039/mo |
| 4,001-4,500 | $409/mo | $649/mo | $1,159/mo |
| 4,501-5,000 | $459/mo | $719/mo | $1,279/mo |

First month: add +$75 for required deep clean on all new members.

## Architecture Decision: Dynamic Stripe Pricing

Since prices vary by home size, we cannot use fixed Stripe price IDs. Instead, the `create-checkout` edge function will use Stripe `price_data` to create dynamic subscription prices at checkout time. This is a clean approach -- Stripe supports it natively for subscriptions.

---

## Plan

### 1. Update `src/config/brand-config.ts` -- Sync Pricing

- Update `HOME_SIZES` base prices to V2 (150, 189, 239, 279, 339, 379, 439, 489, 539)
- Update `baseHours` to V2 (2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6)
- Replace `SERVICE_TIERS` flat `additionalCost` with multiplier-based calculation
- Update `ADD_ONS` prices: Fridge $30, Oven $30, Windows $40
- Update `MEMBERSHIP_PLANS` to reference V2 data structure (prices vary by home size, not flat)
- Update `PRICING.newCustomerDiscount` from 30 to 60
- Update `calculateBasePrice()` to use multiplier logic instead of additive

### 2. Update `src/lib/sales-pricing.ts` -- Multiplier Math

- Change `serviceTierCost` from flat `additionalCost` to `basePrice * (multiplier - 1)`
- Keep everything else the same

### 3. Update `supabase/functions/create-checkout/index.ts` -- Dynamic Subscription Pricing

- Update hardcoded `HOME_SIZE_PRICING` to V2 prices
- Update `SERVICE_PRICING` to use multipliers
- Update `ADD_ON_PRICING` to V2
- Remove fixed `MEMBERSHIP_PRICE_IDS` (no longer used)
- For membership subscriptions: use `price_data` with the correct amount from the V2 lookup table based on `homeSizeId` and `membershipPlan`
- Add `+$75` first-clean surcharge as a separate one-time line item for new members
- Add a standalone subscription path: when request body has `{ priceId, mode: 'subscription', homeSizeId, membershipPlan }` (no booking data), skip booking validation and go straight to Stripe session creation with dynamic pricing

### 4. New Page: `src/pages/membership/PlanDetail.tsx`

A dynamic plan detail page rendered based on URL param (`:planId` = monthly | biweekly | weekly). Includes:

**Section 1 -- Plan Hero**: Plan name, tagline from novaracleaning.com, "starting at $X/mo" (smallest home size price)

**Section 2 -- Home Size Pricing Table**: Interactive selector showing the price for each home size so customers see their exact monthly cost before subscribing. The user selects their home size and the displayed price updates.

**Section 3 -- Benefits** (from novaracleaning.com/membership):
- Monthly: 1 credit/mo (up to 2 hrs), 48-hour reclean guarantee, priority support, 20% off extra hours
- Bi-Weekly: 2 credits/mo (up to 3 hrs each), dedicated cleaner match, 25% off deep cleans & add-ons, satisfaction guarantee
- Weekly: 4 credits/mo (up to 3 hrs each), dedicated cleaner & preferred time, free deep clean every 6 months, 30% off extra hours

**Section 4 -- How It Works**: Subscribe > Schedule > We Clean > Repeat

**Section 5 -- Terms & Disclaimer** (collapsible, from novaracleaning.com/terms):
- Section 5.1: Recurring billing authorization required
- Section 6.2: Cancellation requires 14 days written notice before next billing cycle
- Section 4.4: Rescheduling requires 48 hours notice
- Section 6.4: No refunds for subjective dissatisfaction
- Section 7: Service guarantee (24-hour reporting, one re-clean)
- Section 6.5: Cancellation must be in writing via email or portal
- First month includes mandatory +$75 deep clean surcharge

**Section 6 -- Subscribe CTA**:
- Mandatory "I agree to the Terms of Service" checkbox
- Subscribe button calls `create-checkout` with `{ mode: 'subscription', membershipPlan, homeSizeId }`
- Requires login (redirects to `/auth` if not signed in)

### 5. New Page: `src/pages/membership/MembershipSuccess.tsx`

Post-checkout confirmation page:
- "Welcome to Novara!" message
- Plan summary
- "Schedule Your First Cleaning" CTA linking to `/portal/book`
- Link to account page

### 6. Update `src/pages/Membership.tsx`

- Remove the old hardcoded $189/$289/$389 `MEMBERSHIP_TIERS` object
- Use V2 pricing from `pricing-system.ts` (`MEMBERSHIP_PRICES` lookup)
- Show "Starting at $X/mo" for each plan (smallest home size price)
- Change "Subscribe Now" buttons to navigate to `/membership/:planId` instead of directly calling checkout
- Keep existing current-plan banner, pause/resume functionality

### 7. Update `src/App.tsx` -- Add Routes

- `/membership/:planId` -- PlanDetail page (domain-restricted to `app.novaracleaning.com`)
- `/membership/success` -- MembershipSuccess page (domain-restricted to `app.novaracleaning.com`)

---

## Files Changed

| File | Action | Description |
|---|---|---|
| `src/config/brand-config.ts` | Edit | V2 prices, multipliers, add-on prices, discount amounts |
| `src/lib/sales-pricing.ts` | Edit | Multiplier-based tier pricing |
| `supabase/functions/create-checkout/index.ts` | Edit | V2 pricing, dynamic subscription price_data, +$75 surcharge |
| `src/pages/membership/PlanDetail.tsx` | New | Plan detail page with benefits, pricing table, terms, checkout |
| `src/pages/membership/MembershipSuccess.tsx` | New | Post-checkout success page |
| `src/pages/Membership.tsx` | Edit | V2 pricing, navigate to plan pages |
| `src/App.tsx` | Edit | Add membership routes |

No database migrations needed. No new secrets needed.

