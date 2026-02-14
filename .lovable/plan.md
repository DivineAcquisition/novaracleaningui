

# Format GHL Reschedule Webhook Payload Properly

## Problem

The reschedule webhook currently sends **snake_case** keys like `first_name`, `email`, `old_date`, etc. But every other GHL webhook in the codebase uses **human-readable keys** like `"First Name"`, `"Email"`, `"Scheduled Date"` -- which is what GHL expects to properly map fields to contact records and workflow triggers.

## Fix

Update the `ghlPayload` object in `supabase/functions/reschedule-booking/index.ts` (lines 160-178) to use the same human-readable key format and include formatted values:

### New Payload Structure

| Current Key (snake_case) | New Key (GHL format) | Value Change |
|---|---|---|
| `event_type` | `"Event Type"` | Same value |
| `booking_id` | `"Booking ID"` | Same value |
| `email` | `"Customer Email"` | Same value |
| `first_name` | `"First Name"` | Same value |
| `last_name` | `"Last Name"` | Same value |
| _(missing)_ | `"Full Name"` | Added: `firstName lastName` |
| `phone` | `"Customer Phone"` | Same value |
| `old_date` | `"Previous Date"` | Formatted as MM/DD/YYYY |
| `old_time_slot` | `"Previous Time Slot"` | Same value |
| `new_date` | `"New Scheduled Date"` | Formatted as MM/DD/YYYY |
| `new_time_slot` | `"New Time Slot"` | Same value |
| `service_type` | `"Service Type"` | Same value |
| `address` | `"Service Address"` | Full formatted: `address, city, state zip` |
| `city` | `"City"` | Same value |
| `state` | `"State"` | Same value |
| `zip_code` | `"Zip Code"` | Same value |
| `total_estimate_cents` | `"Total Estimate"` | Converted to dollar string (e.g. `"$250.00"`) |
| `home_size_id` | `"Home Size"` | Same value |
| `rescheduled_at` | `"Rescheduled At"` | Same value |

### Technical Detail

**File**: `supabase/functions/reschedule-booking/index.ts` (lines 160-178)

Replace the `ghlPayload` object with properly formatted keys and values. Add a small date formatting helper inline to convert `YYYY-MM-DD` to `MM/DD/YYYY`, matching the `formatDateMMDDYYYY` pattern used in `send-zapier-webhook`.

After deploying, a test call will be made to verify the formatted payload arrives correctly in GHL.

