

# Centralize Sales Closer and Booking Intake into One Unified Flow

## Why Centralize

The two tabs duplicate most of the same data entry:

| Data | Sales Closer | Booking Intake |
|------|:---:|:---:|
| Name, email, phone | Yes | Yes |
| Source / channel | Yes | Yes |
| Service type, home size | Yes | Yes |
| ZIP code | Yes | Yes |
| Frequency, add-ons | Yes | Yes |
| Preferred date/time | Yes | Yes |
| Address (full, autocomplete) | Only at confirmation | Yes |
| Bedrooms, bathrooms, pets | Partial | Yes |
| Dwelling type | No | Yes |
| SDR rep name | No | Yes |
| Cleaner assignment | No | Yes |
| Payment method/status | Only at confirmation | Yes |
| Notes (access, team, dispatch) | No | Yes |
| Membership plan | No | Yes |
| Live quote sidebar | Yes | No |
| Sales scripts/objections | Yes | No |
| Follow-up scheduler | Yes | No |

A single flow eliminates the duplication and gives VAs all the tools in one place.

---

## New Design: Single-Page Wizard with Sidebar Tools

Remove the two tabs entirely. Replace with a **single scrollable form** (left/center) with a **sticky sidebar** (right) that shows the live quote, sales assist, and follow-up scheduler -- the tools that were unique to the Sales Closer.

### Form Sections (left/center, 2-column grid)

1. **Customer Information** -- Name, email, phone, source, SDR rep name, channel (merged from both)
2. **Service Address** -- Address autocomplete, city/state/ZIP, bedrooms, bathrooms, dwelling type, pets
3. **Service Details** -- Home size, service type, add-ons, frequency
4. **Scheduling** -- Date, time slot, estimated duration, arrival window
5. **Booking Configuration** -- Booking channel, payment method, payment status, membership, new customer discount toggle
6. **Cleaner Team Assignment** -- Number of cleaners (auto-calculated), pay rate, cleaner search/select
7. **Notes** -- Access notes, team notes, dispatch notes
8. **Confirm & Submit** -- Summary bar with total price, deposit, and "Create Booking" button

### Sidebar (right column, sticky)

- **Live Quote Panel** -- Real-time pricing (already exists as `LiveQuotePanel`)
- **Sales Assist Panel** -- Scripts, objection handling, tips (already exists as `SalesAssistPanel`)
- **Follow-Up Scheduler** -- Schedule callbacks (already exists as `FollowUpScheduler`, shown after lead is saved)
- **Customer Recognition Card** -- Membership/returning status (already exists)

### Header Changes

- Remove the `TabsList` entirely
- Title becomes just "Novara Sales & Intake" (no tab switching)
- Keep the "Save Lead" button (saves contact info to leads table for pipeline tracking)
- Keep the "Create Booking" button (submits the full booking)
- Remove the `/admin/booking-intake` redirect page since there are no longer separate tabs

---

## Technical Details

### Files modified

| File | Change |
|------|--------|
| `src/pages/admin/SalesTool.tsx` | Remove `Tabs`/`TabsContent` wrappers. Merge intake fields into the main form. Remove duplicate state (use intake state as the single source). Move sidebar components (LiveQuotePanel, SalesAssistPanel, FollowUpScheduler) to the right column. Wire all fields to the single `handleIntakeSubmit` handler. |
| `src/pages/admin/BookingIntake.tsx` | Simplify redirect to just `/admin/sales` (no `?tab=intake` needed anymore). |

### State consolidation

The current file has two sets of state -- `lead`/`qual` (Sales Closer) and `intakeFirstName`/`intakeLastName`/etc. (Intake). The merged version will:

- Keep the `intake*` state variables as the primary state (they are more complete)
- Remove the `lead`/`qual` objects and the `LeadIntakeSection`/`QualificationSection` components from the rendered output
- Feed the intake state into the sidebar components (`LiveQuotePanel`, `SalesAssistPanel`) which currently read from `lead`/`qual`
- Keep `savedLeadId` for the "Save Lead" functionality and follow-up scheduler

### Components no longer rendered directly

- `LeadIntakeSection` -- Its fields are replaced by the intake form's customer info section (which has more fields)
- `QualificationSection` -- Its fields are replaced by the intake form's service details section
- `BookingConfirmationSection` -- Its address/payment fields are already in the intake form; the "confirm booking" action becomes the main submit button

These components remain in the codebase (they are not deleted) in case they are used elsewhere, but they are no longer imported in `SalesTool.tsx`.

### Layout structure

```text
+--------------------------------------------------+
|  Header: Logo | Title | [Save Lead] [Create Booking] |
+--------------------------------------------------+
|  Customer Search Bar                              |
+--------------------------------------------------+
|                          |                        |
|  Customer Information    |  Live Quote Panel      |
|  Service Address         |  Sales Assist Panel    |
|  Service Details         |  Follow-Up Scheduler   |
|  Scheduling              |  (sticky sidebar)      |
|  Booking Configuration   |                        |
|  Cleaner Team Assignment |                        |
|  Notes                   |                        |
|                          |                        |
+--------------------------------------------------+
```

### No database changes needed

The database columns and edge functions from the previous implementation are already correct. This is purely a UI consolidation.

