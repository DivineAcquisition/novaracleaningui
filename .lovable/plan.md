

# Sales Intake Tool -- Gap Analysis and Completion Plan

After reviewing every component, here is what is missing or incomplete to make the tool fully functional for your VA.

---

## 1. "Email Quote" button is a placeholder

The LiveQuotePanel has an "Email Quote" button that currently shows a toast saying "coming in Phase 2". It needs to actually send a branded quote email via the existing `send-booking-email` or a new edge function using Resend.

**Work needed:**
- Create a `send-sales-quote-email` edge function (or reuse existing email infrastructure)
- Wire the button to call it with the quote data and lead email
- Save the quote to the `sales_quotes` table when sent and log it in `lead_activity_log`

---

## 2. Booking confirmation does NOT trigger webhooks or confirmation emails

When the VA clicks "Confirm Booking," the booking is saved to the `bookings` table but:
- No confirmation email is sent to the customer
- No webhook fires to GoHighLevel or Zapier
- No Google Calendar event is created

**Work needed:**
- After booking insert, call `send-booking-email` edge function
- Call `send-lead-capture-webhook` or `send-zapier-webhook` with booking data
- Optionally call `create-google-calendar-event`

---

## 3. Lead status changes don't propagate from the Pipeline

The Kanban pipeline cards are read-only. You cannot drag-and-drop or click to change a lead's status, edit details, or open the lead in the Sales Tool.

**Work needed:**
- Add click-to-open behavior (navigate to `/admin/sales?leadId=xyz` and pre-fill the form)
- Add a status dropdown or drag-and-drop on pipeline cards to update status directly
- Add a lead detail slide-out panel

---

## 4. No way to edit or re-open a saved lead

Once a lead is saved, the tool shows "Saved" and disables the button. If the VA needs to update notes, re-qualify, or change info, there is no edit flow.

**Work needed:**
- Support loading an existing lead by ID (from URL param or pipeline click)
- Pre-fill all fields from the lead record
- Change "Save Lead" to "Update Lead" when editing

---

## 5. Follow-up reminders have no notification mechanism

Follow-ups are saved to the database but nothing reminds the VA when one is due. The pipeline shows a count but there is no alert or notification.

**Work needed:**
- Add a "Follow-ups Due Today" banner or toast on the Sales Tool page load
- Optionally add a scheduled edge function that sends SMS/email reminders to the VA

---

## 6. No quote saved to the `sales_quotes` table

The quote is calculated client-side but never persisted. This means:
- No quote history per lead
- Pipeline cards cannot show quote amounts
- "Average deal value" stat on pipeline is missing

**Work needed:**
- Save quote to `sales_quotes` when "Save Lead" or "Copy Quote" is clicked
- Display quote amount on pipeline cards
- Calculate average deal value and total revenue booked in pipeline stats

---

## 7. Pipeline stats are incomplete

The pipeline currently shows Total Leads, Conversion Rate, Booked count, and Follow-ups Due. Missing:
- Total revenue booked (sum of booked leads' quote amounts)
- Average deal value
- Date range filtering (this week / this month)

**Work needed:**
- Join leads with `sales_quotes` or `bookings` to calculate revenue
- Add date range selector to filter stats

---

## 8. No autosave for the sales form

The original spec mentioned auto-save so the VA doesn't lose data if they navigate away mid-call. Currently the form resets on page load.

**Work needed:**
- Save form state to localStorage every 30 seconds (same pattern as the existing admin intake form)
- Prompt to restore on page load

---

## 9. Pricing comes from hardcoded config, not Supabase

The spec says "never hardcode pricing." Currently all pricing, home sizes, service tiers, and add-ons come from `brand-config.ts`, not from the `pricing_config` Supabase table. The `usePricingConfig` hook exists but is unused.

**Work needed:**
- Either accept the current config-file approach (simpler, already working)
- Or refactor to pull pricing from Supabase dynamically (more complex, matches original spec)
- Recommendation: keep the config file for now since it is the single source of truth used across the entire app

---

## Priority Recommendation

The items most critical for your VA to actually close deals today:

| Priority | Item | Impact |
|----------|------|--------|
| High | #2 -- Trigger confirmation emails and webhooks on booking | Customers and GHL won't know about the booking without this |
| High | #4 -- Load/edit existing leads | VA can't update leads after saving |
| High | #1 -- Wire up "Email Quote" | VA can't send quotes from the tool |
| Medium | #3 -- Clickable pipeline cards | VA can't act on pipeline leads |
| Medium | #6 -- Persist quotes | No revenue tracking without this |
| Medium | #8 -- Autosave | Protects against lost work on calls |
| Low | #5 -- Follow-up notifications | Nice to have, VA can check pipeline manually |
| Low | #7 -- Pipeline stats | Reporting enhancement |
| Low | #9 -- Dynamic pricing from DB | Current config approach works fine |

---

## Technical Approach

All high/medium items can be implemented by:
1. Adding a `useEffect` + URL param reader in `SalesTool.tsx` to load existing leads
2. Calling existing edge functions (`send-booking-email`, `send-lead-capture-webhook`) after booking confirmation
3. Creating one new edge function `send-sales-quote-email` for emailing quotes
4. Adding `onClick` handlers to pipeline cards to navigate to the sales tool
5. Adding localStorage autosave with the same pattern already used in the admin intake form
6. Inserting into `sales_quotes` table during quote copy/send actions

No new database tables are needed -- all required tables already exist.

