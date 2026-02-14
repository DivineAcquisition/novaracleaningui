

# Multi-Part Update: Sales Submit, Name Dedup, Customer Portal Overhaul, Reschedule Webhook

This plan covers 4 distinct areas of work.

---

## 1. Sales Tool: "Create Booking" Already Exists

The "Create Booking" submit button is **already implemented** in `SalesTool.tsx` (line 540-543). It:
- Validates all required fields (customer info, address, service, schedule)
- Inserts into `bookings` table with full pricing
- Creates `jobs` + `job_assignments` if cleaners are selected
- Calls `send-zapier-webhook` for CRM sync
- Calls `send-booking-email` for confirmation email
- Navigates to dispatch queue on success

**No changes needed here** -- this is already working.

---

## 2. Customer Search: Deduplicate by Name, Show All Contact Info

### Problem
The current dedup keys on email and phone, but the same person with the same name but different emails/phones still shows multiple rows.

### Solution
Update `useCustomerSearch` in `src/hooks/use-sales-data.ts` to:

1. Add a **third dedup key by normalized name** (`firstName lastName` lowercased, trimmed)
2. When a name match is found, **merge** the contact info rather than skip -- collect all emails and phones into arrays
3. Update the `CustomerSearchResult` interface to support multiple contacts: add `allEmails: string[]` and `allPhones: string[]`
4. The primary `email` and `phone` fields will be the **most recent / most-used** one (from bookings first, then customers, then carts)

### Display Changes in `SalesTool.tsx`
Update the search results dropdown (line 583-594) to show all associated emails and phones beneath the name, with the primary one highlighted.

### Files Changed
- `src/hooks/use-sales-data.ts` -- Add name-based dedup, `allEmails`/`allPhones` fields, prioritize by recency
- `src/pages/admin/SalesTool.tsx` -- Update search result display to show all contact methods

---

## 3. Customer Portal (Account Page) -- Complete Overhaul

### Current Issues
- Functional but basic card-based layout
- Reschedule dialog uses a horizontal scroll date picker that's hard to use
- No webhook to GHL on reschedule from the customer portal side

### Redesign: `src/pages/Account.tsx`

**New Layout** -- Clean, modern dashboard with clear sections:

```
+--------------------------------------------------+
|  Header: Welcome Back, [Name]    [Book] [Sign Out]|
+--------------------------------------------------+
|  [Next Cleaning Card - hero style]               |
|   Date, time, address, countdown                  |
|   [Reschedule] [Modify] [Cancel]                  |
+--------------------------------------------------+
|  [Membership Card]  |  [Quick Actions]            |
|   Credits, plan      |   Book, Billing, Refer     |
+--------------------------------------------------+
|  Upcoming Bookings (list)                         |
+--------------------------------------------------+
|  Past Bookings (collapsible table)                |
+--------------------------------------------------+
```

Key improvements:
- Hero card for the next upcoming booking with prominent action buttons
- Better visual hierarchy with status colors
- Countdown to next cleaning ("in 3 days")
- Collapsible past bookings section
- Mobile-responsive card layout instead of dense tables

### Reschedule Dialog UI Overhaul: `src/components/booking/RescheduleDialog.tsx`

Replace the horizontal scroll date picker with:
- A **calendar grid** (using the existing `Calendar` component from shadcn) for date selection
- A cleaner **vertical list** of time slots with radio-style selection
- Current booking info displayed as a highlighted summary card at the top
- Better loading/success states with animations

---

## 4. Reschedule Webhook to GHL

### New webhook call in `supabase/functions/reschedule-booking/index.ts`

After the booking is updated and email is sent, add a direct POST to the GHL reschedule webhook:

```
URL: https://services.leadconnectorhq.com/hooks/fJddieqJDUjUoYAGOvbk/webhook-trigger/f8326cbb-8ef8-4220-bd54-746e909bcb2f
```

The payload will include:
- `booking_id`, `email`, `first_name`, `last_name`, `phone`
- `old_date`, `old_time_slot`
- `new_date`, `new_time_slot`
- `service_type`, `address`, `city`, `state`, `zip_code`
- `total_estimate_cents`
- `event_type: "booking_rescheduled"`

This will be a direct `fetch()` call in the edge function (no new secret needed since the URL is hardcoded like other GHL endpoints).

### Send a Test

After deploying the updated edge function, I will call it with a test booking ID to verify the webhook fires correctly.

---

## Technical Summary

| File | Change |
|------|--------|
| `src/hooks/use-sales-data.ts` | Add name-based dedup key, `allEmails`/`allPhones` arrays, prioritize most-used contact |
| `src/pages/admin/SalesTool.tsx` | Update search dropdown to display all emails/phones per person |
| `src/pages/Account.tsx` | Complete UI overhaul with hero next-booking card, better layout, mobile-friendly |
| `src/components/booking/RescheduleDialog.tsx` | Replace horizontal date scroll with calendar grid, cleaner time slot list |
| `supabase/functions/reschedule-booking/index.ts` | Add GHL webhook POST after successful reschedule |

No database migrations needed.

