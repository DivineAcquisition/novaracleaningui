
# Branded Sales & Intake Tool + Cleaner Management Overhaul

## Overview

Three areas of work:

1. **Brand the Sales & Intake page** with the Novara logo, green color scheme, and polished styling
2. **Add cleaner assignment fields to the Intake form** (number of cleaners, $18/hr rate, cleaner search/select with duplicate prevention) and enrich the booking webhook with SDR rep name and cleaner data
3. **Overhaul the Cleaner Management page** (`/admin/cleaners`) to be fully functional with inline editing, status toggling, service ZIP management, search/filter, and action completeness

---

## 1. Brand the Sales & Intake Page

Currently the page uses a generic `bg-slate-950` dark theme with amber accents. It needs to use the Novara brand:

- Add the Novara logo (`/novara-logo.png`) to the header alongside the title
- Replace the amber accent color scheme with the Novara green (`hsl(142, 76%, 36%)`) for buttons, active tab indicators, badges, and highlights
- Update the PIN gate screen with the logo and green button styling
- Keep the dark background for contrast but use green for all interactive elements

### Files modified
- `src/pages/admin/SalesTool.tsx` -- Header logo, color classes

---

## 2. Cleaner Fields in the Intake Form

### 2a. New "SDR Rep Name" field
- Add an `intakeSdrRepName` state field in the intake tab
- Simple text input for the rep's name (e.g., "Maria G.")
- This value gets saved to the booking

### 2b. Cleaner team configuration section (replaces current optional section)
- **Number of Cleaners**: Auto-calculated from home size (2 for homes up to 2500 sqft, 3 for larger), but editable by the SDR
- **Pay Rate**: Fixed at $18/hr, displayed as read-only with explanation
- **Cleaner Search & Select**: The existing `CleanerMultiSelect` component already handles this, but needs:
  - A search/filter input at the top to find cleaners by name
  - Duplicate prevention (already exists -- checkbox toggle prevents re-adding)
  - The max count should match the "Number of Cleaners" field instead of being hardcoded at 3

### 2c. Database migration
- Add `sdr_rep_name` column (text, nullable) to the `bookings` table
- Add `num_cleaners_assigned` column (integer, nullable) to the `bookings` table

### 2d. Save SDR rep name and cleaner count on booking insert
- Pass `sdr_rep_name` and `num_cleaners_assigned` to the bookings insert in `handleIntakeSubmit`

### 2e. Enrich the booking webhook payload
- Add `"SDR Rep Name"` field to the `send-zapier-webhook` edge function's booking payload
- Add `"Num Cleaners Assigned"` to the payload
- The webhook already includes cleaner details for assigned cleaners; add the intake-assigned cleaner names as well

### 2f. Trigger the booking webhook from Intake form
- After booking creation in `handleIntakeSubmit`, call `send-zapier-webhook` with the new booking ID (currently not done)
- Also call `send-booking-email` for the confirmation email

### Files modified
- `src/pages/admin/SalesTool.tsx` -- New state fields, UI for SDR rep, cleaner count, search filter, webhook calls after submit
- `src/components/admin/CleanerMultiSelect.tsx` -- Add name search filter input, dynamic max count prop
- `supabase/functions/send-zapier-webhook/index.ts` -- Add SDR Rep Name and cleaner count fields to payload

### Database migration
```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sdr_rep_name text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS num_cleaners_assigned integer;
```

---

## 3. Cleaner Management Page Overhaul

The current `/admin/cleaners` page is functional but limited. Here is what needs to be fixed and added:

### 3a. Missing functionality to fix
- **No search/filter**: Add a search input to filter by name, email, or phone
- **No status toggling**: Add inline buttons to activate/deactivate cleaners
- **No ZIP code display**: Show service ZIP codes for each cleaner in the table
- **No edit capability**: Add an edit dialog to update cleaner details (name, phone, state, home ZIP, service ZIPs, pay rate, max travel miles)
- **No delete/deactivate**: Add a button to deactivate a cleaner (set `status = 'inactive'` and `available_for_bookings = false`)
- **No rating display**: Show average rating and total ratings in the table
- **Missing columns**: Add `state`, `home_zip`, `service_zip_codes`, `pay_rate_hr`, `average_rating` to the table view

### 3b. Improved stats cards
- Add: Pending Approval count, Total Completed Bookings across all cleaners, Average Rating

### 3c. Actions column improvements
- "Approve" button for unapproved cleaners (exists, keep)
- "Edit" button to open edit dialog
- "Activate/Deactivate" toggle
- "Stripe Onboarding" link (exists, keep)
- "Check Status" button (exists, keep)
- "View Profile" link to the cleaner directory entry

### Files modified
- `src/pages/admin/Cleaners.tsx` -- Complete rewrite of the table with search, filters, edit dialog, action buttons, expanded columns

---

## Technical Details

### Component changes summary

| File | Changes |
|------|---------|
| `src/pages/admin/SalesTool.tsx` | Add Novara logo + green branding. Add SDR rep name field. Add cleaner count field (auto-calculated). Add search filter to cleaner section. Call `send-zapier-webhook` and `send-booking-email` after intake submit. |
| `src/components/admin/CleanerMultiSelect.tsx` | Add `maxCleaners` prop (replaces hardcoded 3). Add name search/filter input at top of available cleaners list. |
| `src/pages/admin/Cleaners.tsx` | Add search input. Add edit dialog with all cleaner fields. Add activate/deactivate toggles. Show service ZIPs, pay rate, rating, state in table. Improve stats cards. |
| `supabase/functions/send-zapier-webhook/index.ts` | Add `"SDR Rep Name"` and `"Num Cleaners Assigned"` to booking webhook payload. |

### New database columns
- `bookings.sdr_rep_name` (text, nullable)
- `bookings.num_cleaners_assigned` (integer, nullable)

### No new edge functions needed
All webhook and email functions already exist; they just need to be called from the intake form submission handler.
