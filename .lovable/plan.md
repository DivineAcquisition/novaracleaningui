

# Customer Search + Sales Form Verification

## 1. Customer Search Feature

Add a **customer/booking search** section to the Lead Intake area of the Sales Tool. When the VA types a name, email, or phone number, the tool searches across three tables:

- **customers** -- people who have registered or had bookings
- **bookings** -- anyone who booked (confirmed, pending, cancelled)
- **abandoned_carts** -- people who started but didn't finish booking

### How it works
- A search input field at the top of the Lead Intake section with a "Search Customers" label
- Searches by name, email, or phone across all three tables
- Results appear in a dropdown/popover showing:
  - Customer name, email, phone
  - Status badge: "Booked Before" (green), "Abandoned Cart" (amber), "Customer Record" (blue)
  - Last booking date and service type (if applicable)
  - Number of past bookings
- Clicking a result auto-fills the Lead Intake fields (name, email, phone) and toggles "Existing Customer" on
- This replaces the current "toggle existing customer + type email" workflow with something faster and more intuitive

### Database queries
- Search `customers` by `first_name`, `last_name`, `email`, or `phone` using `ilike`
- Search `bookings` by `first_name`, `last_name`, `email`, or `phone` using `ilike` (deduplicated by email)
- Search `abandoned_carts` by `first_name`, `last_name`, `email` using `ilike`
- Combined into one search results list, deduplicated by email

## 2. Sales Form Issues to Fix

After reviewing the full codebase, these are functional issues:

### a. "Existing Customer" toggle only searches by exact email match
The current `useCustomerLookup` hook requires the VA to toggle the switch AND type the exact email. The new search feature above replaces this with a proactive search.

### b. Booking Confirmation city field not auto-filled from ZIP lookup
When the VA enters a ZIP code in Qualification, the `useServiceCoverage` hook returns `city` and `state`. But in the Booking Confirmation section, `city` and `state` start as empty strings. They should auto-fill from the coverage zone data.

### c. Lead status not updating to "contacted" or "quoted" automatically
When the VA saves a lead, sends a quote email, or copies a quote, the lead status stays at "new". It should auto-advance:
- After saving lead: remain "new" (correct)
- After emailing/copying a quote: update to "quoted"
- After scheduling a follow-up: update to "follow_up"

---

## Technical Details

### New hook: `useCustomerSearch`
```
Location: src/hooks/use-sales-data.ts

New exported hook that takes a search query string (min 2 chars).
Runs parallel queries on customers, bookings, and abandoned_carts.
Returns unified results with source tags.
Debounced to avoid excessive queries while typing.
```

### Files to modify

| File | Change |
|------|--------|
| `src/hooks/use-sales-data.ts` | Add `useCustomerSearch` hook |
| `src/components/sales/LeadIntakeSection.tsx` | Add search input + results dropdown above the form fields. On result click, auto-fill lead data. |
| `src/components/sales/BookingConfirmationSection.tsx` | Accept coverage zone data as prop, auto-fill city/state from it |
| `src/components/sales/LiveQuotePanel.tsx` | After emailing/copying quote, update lead status to "quoted" |
| `src/pages/admin/SalesTool.tsx` | Pass coverage data to BookingConfirmation; wire up search results to fill lead fields |

### No database changes needed
All tables already exist with the right columns and RLS policies.

