

# Update Migma Email Template Replacement Logic

## Problem
The Migma booking confirmation template (v7) now uses **GoHighLevel (GHL) dynamic variables** like `{{contact.first_name}}`, `{{contact.deposit_amount_}}`, `{{appointment.start_date}}`, etc. However, the current `populateMigmaTemplate` function in `send-booking-email/index.ts` still uses **hardcoded regex replacements** targeting old test values (e.g., replacing "Test", "NOV-00001", "$189.00"). These regexes are fragile and will break whenever the template is updated in Migma.

## Solution
Rewrite `populateMigmaTemplate` to replace the GHL-style `{{variable}}` placeholders with actual booking data. This is far more reliable -- the placeholders are consistent and won't change with template design updates.

## Changes

### File: `supabase/functions/send-booking-email/index.ts`

**Replace the entire `populateMigmaTemplate` function** with a GHL-variable-based replacement approach:

| GHL Placeholder | Booking Data Source |
|---|---|
| `{{contact.first_name}}` | `data.firstName` |
| `{{opportunity.name}}` | `data.bookingNumber` |
| `{{appointment.start_date}}` | `formatServiceDate(data.serviceDate)` |
| `{{contact.service_start_time}}` | `data.arrivalWindow` or `data.timeSlot` |
| `{{contact.address1}}` | Full address string |
| `{{contact.novara_glow_plan}}` | Membership plan or "N/A" |
| `{{contact.cleaning_type}}` | Service type label |
| `{{contact.service_frequency}}` | `data.frequency` |
| `{{contact.bedrooms}}` | `data.bedrooms` |
| `{{contact.bathrooms}}` | `data.bathrooms` |
| `{{contact.estimated_sqft}}` | `data.sqft` |
| `{{contact.add_ons}}` | Joined add-ons list |
| `{{contact.final_cost_}}` | `formatCurrency(data.totalAmount)` |
| `{{contact.deposit_amount_}}` | `formatCurrency(data.depositAmount)` |
| `{{contact.remaining_balance}}` | `formatCurrency(data.balanceAmount)` |
| `{{contact.last_invoice_url}}` | `data.hostedInvoiceUrl` |
| `{{contact.referral_link}}` | `data.referralLink` |
| `{{appointment.reschedule_link}}` | Reschedule URL or "#" |
| `{{appointment.cancellation_link}}` | Cancellation URL or "#" |
| `{{unsubscribe_link}}` | Unsubscribe URL or "#" |

**Additional data fields** to add to the `BookingEmailRequest` interface:
- `membershipPlan?: string` -- for the "Active Plan" row
- `rescheduleLink?: string` -- for the reschedule CTA
- `cancellationLink?: string` -- for the cancel CTA

The replacement will use a simple map-based approach: iterate over a key-value map of `{ "{{placeholder}}": value }` and do a global string replace for each. This is cleaner than fragile regex patterns.

### Technical Details

```text
populateMigmaTemplate(html, data):
  1. Build a replacements map: { "{{contact.first_name}}": data.firstName, ... }
  2. For each entry, do html.replaceAll(key, value)
  3. Handle URL-encoded variants (Migma may encode {{ }} in href attributes as %7B%7B...%7D%7D)
  4. Return the fully populated HTML
```

The function will also handle the URL-encoded versions of placeholders (e.g., `%7B%7Bcontact.referral_link%7D%7D`) since Migma wraps link hrefs with encoded curly braces as seen in the template source.

### Deployment
- Update and deploy the `send-booking-email` edge function
- No database changes needed
- No frontend changes needed

