
# Sales Intake Form: Fixes, Membership Replacement, and Custom Discount

## Issues Found

1. **Add-ons section broken** -- The form iterates `ADD_ONS` from `pricing-system.ts` (an object with keys `fridge`, `oven`, `windows`) using `Object.entries()` and accesses `.label`/`.price`, which works. However, the `addOns` state stores keys like `"fridge"` from `pricing-system.ts`, but `LiveQuotePanel` looks up add-ons from `brand-config.ts` (an array with `.id` like `"fridge"`). The IDs happen to match, so this works -- but the sidebar shows 3 add-ons while the form shows 3, so this is consistent. No actual breakage here, just messy dual-source pattern.

2. **Frequency dropdown uses wrong values** -- The dropdown includes "Biweekly" and "Quarterly" but `sales-pricing.ts` only knows "One-Time", "Weekly", "Bi-Weekly", "Monthly". "Biweekly" vs "Bi-Weekly" is a mismatch, and "Quarterly" has no pricing logic at all.

3. **New customer discount still active** -- The checkbox on line 902-906 applies a hardcoded $60 discount. `sales-pricing.ts` line 68-69 also hardcodes `-$60` for new customers. Both need removal.

4. **LiveQuotePanel shows stale discount UI** -- Even with frequency discounts set to 0, it still renders the "New customer discount -$60.00" line when `isNewCustomer` is true.

5. **Two pricing calculators showing different things** -- `LiveQuotePanel` (uses `sales-pricing.ts`) and `IntakePricingSidebar` (uses `pricing-system.ts`) can show different totals because they use different discount logic paths.

---

## Plan

### 1. Replace "Frequency" with "Novara Glow Membership" (3 options + One-Time)

**File: `src/pages/admin/SalesTool.tsx`**
- Rename the `frequency` state conceptually (keep the variable name for compatibility)
- Replace the frequency dropdown (lines 813-824) with 4 styled buttons:
  - **One-Time** (Pay Per Clean)
  - **Glow Monthly** (1 clean/month)
  - **Glow Bi-Weekly** (2 cleans/month) -- marked "Popular"
  - **Glow Weekly** (4 cleans/month)
- Label the section "Novara Glow Membership" instead of "Frequency"
- Use consistent values: `"One-Time"`, `"Monthly"`, `"Bi-Weekly"`, `"Weekly"`

### 2. Remove New Customer Discount, Add Custom Discount Input

**File: `src/pages/admin/SalesTool.tsx`**
- Remove the `applyNewCustomerDiscount` state and checkbox (lines 151, 902-906)
- Add a new `customDiscount` state (number, in dollars)
- Add an input field in Booking Configuration: "Discount ($)" with a number input
- Pass `customDiscount` to both pricing panels and the booking creation logic

**File: `src/lib/sales-pricing.ts`**
- Remove the hardcoded `isNewCustomer` $60 deduction (lines 68-70)
- Add a `customDiscountCents` parameter to `calculateQuote` instead
- Update `formatQuoteText` to show custom discount if applied

**File: `src/components/sales/LiveQuotePanel.tsx`**
- Remove `isNewCustomer` prop
- Add `customDiscount` prop (dollars)
- Pass it to `calculateQuote` as `customDiscountCents`
- Update the UI to show "Discount" line instead of "New customer discount"

**File: `src/components/admin/IntakePricingSidebar.tsx`**
- Remove `applyNewCustomerDiscount` prop
- Add `customDiscount` prop (dollars)
- Subtract custom discount from total instead of calling `calculatePrice` with new customer flag

### 3. Fix Pricing Consistency

**File: `src/pages/admin/SalesTool.tsx`**
- In `handleCreateBooking` (line 422): remove `applyNewCustomerDiscount` parameter, add custom discount to the pricing call
- Send `customDiscount` amount in the GHL webhook payload

### 4. Remove Frequency Discount References

**File: `src/components/sales/QualificationSection.tsx`**
- Rename "Frequency" label to "Novara Glow Membership"
- Keep existing button-based UI but update labels to match membership plan names

---

## Technical: Files Changed

| File | Change |
|---|---|
| `src/pages/admin/SalesTool.tsx` | Replace frequency dropdown with membership buttons, remove new customer discount checkbox, add custom discount input, update booking creation and webhook payload |
| `src/lib/sales-pricing.ts` | Remove `isNewCustomer` $60 logic, add `customDiscountCents` param |
| `src/components/sales/LiveQuotePanel.tsx` | Replace `isNewCustomer` prop with `customDiscount`, update display |
| `src/components/admin/IntakePricingSidebar.tsx` | Replace `applyNewCustomerDiscount` with `customDiscount` prop |
| `src/components/sales/QualificationSection.tsx` | Rename "Frequency" to "Novara Glow Membership" |
