
# Combine Sales Tool + Booking Intake into One Standalone Page

## What Changes

The current `/admin/sales` (Sales Closer) and `/admin/intake` (Phone Booking Intake) pages will be merged into a single standalone page at `/admin/sales`. The Intake page (`/admin/intake`) will redirect to `/admin/sales` for backwards compatibility.

### Key Design Decisions

1. **PIN gate first** -- The combined page uses the same 4-digit PIN gate pattern from the current Intake form. No admin sidebar, no admin layout. It is a fully independent page.

2. **Tabbed layout** -- The page has two main tabs:
   - **Sales Closer** -- The existing lead intake, qualification, live quote, scripts, and follow-up flow (for warm leads, calls, and deal-closing)
   - **Booking Intake** -- The existing full booking form with address autocomplete, cleaner assignment, scheduling, payment config, and notes (for confirmed phone bookings)

3. **Shared customer search** -- The unified customer search (across customers, bookings, abandoned_carts) sits above both tabs so the VA can look up a customer once and the data flows into whichever tab they use.

4. **No AdminLayout wrapper** -- The page renders its own minimal header with a back/logout button instead of the sidebar navigation. Completely standalone.

5. **Session persistence** -- PIN auth stays in `sessionStorage` so it persists across tab refreshes but not new browser sessions.

---

## Page Structure

```text
+--------------------------------------------------+
|  [Lock icon]  Enter 4-digit PIN                   |
|  [____] [____] [____] [____]                      |
|  [Access Form]                                    |
+--------------------------------------------------+

        (after PIN is accepted)

+--------------------------------------------------+
|  Novara Sales & Intake    [Pipeline] [New] [Save] |
+--------------------------------------------------+
|  [Search customers, bookings, carts...]           |
+--------------------------------------------------+
|  [ Sales Closer ]  [ Booking Intake ]   (tabs)    |
+--------------------------------------------------+
|                                                   |
|  (tab content here)                               |
|                                                   |
+--------------------------------------------------+
```

---

## Technical Changes

### 1. Rewrite `src/pages/admin/SalesTool.tsx`

- Remove the `AdminLayout` wrapper
- Add the 4-digit PIN gate (same pattern as current BookingIntake)
- Add a minimal standalone header (no sidebar)
- Add `Tabs` component with "Sales Closer" and "Booking Intake" tabs
- Move the existing Sales Closer content into the first tab
- Move the existing Booking Intake form content into the second tab (inline, not importing the old page)
- Shared customer search at the top that auto-fills whichever tab is active
- Keep all existing functionality: autosave, lead loading via URL params, quote emailing, booking confirmation triggers

### 2. Update `src/pages/admin/BookingIntake.tsx`

- Replace the entire file with a simple redirect to `/admin/sales?tab=intake`
- This preserves backwards compatibility for any bookmarks or links

### 3. Update `src/App.tsx`

- Remove the `ProtectedRoute` and `DomainRestricted` wrappers from `/admin/sales` since the page handles its own PIN authentication
- Keep the `/admin/intake` route pointing to the redirect component

### 4. Update `src/components/admin/AdminLayout.tsx`

- Remove "Sales" and "Intake" from the sidebar nav items since they are now a standalone page outside the admin layout

### 5. No changes to edge functions, database, or existing components

All sales sub-components (`LeadIntakeSection`, `QualificationSection`, `LiveQuotePanel`, `BookingConfirmationSection`, `FollowUpScheduler`, `SalesAssistPanel`) remain unchanged. The Intake-specific components (`IntakePricingSidebar`, `CleanerMultiSelect`, `CustomerRecognitionCard`, `AddressAutocomplete`) are reused directly.

---

## What the VA Experiences

1. Navigate to `/admin/sales` (or click a bookmark)
2. Enter the 4-digit PIN (1234)
3. See a clean, standalone page with a customer search bar at the top
4. Choose the **Sales Closer** tab for lead management and deal-closing, or the **Booking Intake** tab for creating confirmed bookings with full address, cleaner assignment, and payment details
5. Search results auto-fill the active tab's form
6. No sidebar, no admin chrome -- just the tool they need
