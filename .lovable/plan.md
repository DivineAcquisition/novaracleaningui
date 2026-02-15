
# Sales Intake Form Improvements

## 1. Send Booking Data to GHL Webhook

When "Create Booking" is clicked, send all form data to the new GHL webhook endpoint:
`https://services.leadconnectorhq.com/hooks/fJddieqJDUjUoYAGOvbk/webhook-trigger/dQxXR74sgYXEvShKnBKO`

This will be added directly in `handleCreateBooking()` in `SalesTool.tsx`, right after the booking is created and before navigation. The payload will include all customer, address, service, scheduling, pricing, and cleaner assignment data.

## 2. More Time Slots

Currently only 3 time slots exist (8AM-12PM, 12PM-4PM, 4PM-8PM). Replace with hourly slots from 8AM to 6PM:
- 8:00 AM, 9:00 AM, 10:00 AM, 11:00 AM, 12:00 PM, 1:00 PM, 2:00 PM, 3:00 PM, 4:00 PM, 5:00 PM, 6:00 PM

These will be individual start times rather than 4-hour windows, since the intake tool already captures estimated duration separately.

## 3. Fix Duplicate Cleaners in Selection

The cleaner fetch query (`line 294`) doesn't filter by `status = 'active'` or deduplicate. Will add:
- Filter to only `status = 'active'` cleaners
- Deduplicate by cleaner `id` (in case the distance recalculation effect re-runs and creates duplicates in state)

## 4. Add Delete Cleaner Ability

The `CleanerMultiSelect` component already has a remove (X) button for selected cleaners. However, the user likely wants the ability to delete/deactivate cleaners from the database entirely. Will add a delete button next to each cleaner in the available list that sets their `approved = false` (soft delete) after confirmation.

## 5. Remove Frequency/Membership Discounts from Sales Pricing

The `sales-pricing.ts` file applies frequency-based discounts (Weekly 20%, Bi-Weekly 15%, Monthly 10%). Since membership/frequency/recurring are the same thing and memberships have their own fixed pricing, these percentage discounts should be removed. The `LiveQuotePanel` uses `sales-pricing.ts`, while `IntakePricingSidebar` uses `pricing-system.ts`.

Changes:
- In `sales-pricing.ts`: Set all `FREQUENCY_DISCOUNTS` to 0 (remove the discount logic)
- Remove the membership select dropdown from the Booking Configuration section (since frequency already captures this)
- The `IntakePricingSidebar` currently uses `calculatePrice()` from `pricing-system.ts` which applies membership discounts on extras -- will pass `membershipPlan` as `'none'` since frequency handles recurrence

## 6. Consistent Pricing

Both the `LiveQuotePanel` (uses `sales-pricing.ts` / `brand-config.ts`) and `IntakePricingSidebar` (uses `pricing-system.ts`) should show the same prices. Both source files share the same base price matrix (Zone B). With frequency discounts removed, they will be consistent. The `IntakePricingSidebar` displays prices in cents while `LiveQuotePanel` also uses cents -- both use the same base prices from the v2 matrix so they'll align once the discount discrepancy is removed.

---

## Technical: Files Changed

| File | Change |
|---|---|
| `src/pages/admin/SalesTool.tsx` | Add GHL webhook call in `handleCreateBooking`, expand time slots, fix cleaner fetch query, remove membership dropdown, add cleaner delete functionality |
| `src/lib/sales-pricing.ts` | Remove frequency discount percentages (set all to 0) |
| `src/components/admin/CleanerMultiSelect.tsx` | Add delete/deactivate button for cleaners in the available list |
