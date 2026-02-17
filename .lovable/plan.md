

# Capture ZIP Entry Data and Fix Lead Tracking Gap

## Problem

Facebook reports 20 people filled out the ZIP form, but the database has 0 abandoned carts, 0 leads, and only 8 customers (most without ZIP data). The root cause: entering a ZIP and clicking "Continue" only saves to browser memory. Nothing is written to the database until the user completes the full contact form (name, email, phone). If they bounce after entering their ZIP, the data is lost entirely.

## Solution

### 1. Track ZIP Submissions Immediately

When a user enters a valid ZIP and clicks "Continue" on `/book/zip`, immediately insert a row into `abandoned_carts` with just the ZIP code and timestamp. This captures intent even if the user never fills out the contact form.

- Insert into `abandoned_carts` with `zip_code`, `last_step = 'zip'`, and a placeholder email (e.g., `anonymous-{uuid}@placeholder`) since `email` is required and NOT NULL.
- Store the generated `abandoned_cart_id` in localStorage so the contact form step can update that same row (instead of creating a duplicate).

### 2. Update the Existing Row on Contact Form Completion

When the user fills out the contact form and submits, update the existing `abandoned_carts` row with their name, email, and phone instead of creating a new one via `track-abandoned-cart`.

### 3. Fire a Meta Pixel `Lead` Event on ZIP Submission

Add a `trackLead` helper to `meta-pixel.ts` and fire it when a valid ZIP is confirmed in the service area. This gives Facebook a signal earlier in the funnel, improving ad optimization.

### 4. Add a `leads` Table Insert for ZIP-Only Visitors

Insert a minimal row into the `leads` table on ZIP submission with `status = 'zip_only'`, `zip_code`, and `source = 'Website'`. This populates the lead pipeline even without contact info, giving visibility into demand by ZIP code.

---

## Technical Details

### Files to Create
| File | Purpose |
|---|---|
| (none) | No new files needed |

### Files to Modify
| File | Change |
|---|---|
| `src/pages/book/Zip.tsx` | Add database insert on ZIP submit (abandoned_carts + leads), fire Meta Pixel Lead event, update existing row on contact form submit |
| `src/lib/meta-pixel.ts` | Add `trackLead()` helper function |

### Database Changes
None required -- both `abandoned_carts` and `leads` tables already exist with the needed columns. The `abandoned_carts.email` column is NOT NULL, so we'll use a placeholder for ZIP-only entries. The `leads` table has `first_name` as NOT NULL with no default, so we'll use "Anonymous" as placeholder.

### Edge Function Changes
None -- the existing `track-abandoned-cart` and `send-lead-capture-webhook` functions work fine. The issue is they were never being reached because users bounced before the contact form.

### Flow After Changes

```text
User enters ZIP + clicks Continue
  |
  +--> INSERT into abandoned_carts (zip_code, last_step='zip')
  +--> INSERT into leads (zip_code, status='zip_only', source='Website')
  +--> Fire Meta Pixel Lead event (if in service area)
  +--> Store cart ID in localStorage
  |
User fills contact form + submits
  |
  +--> UPDATE abandoned_carts row with name, email, phone
  +--> Fire send-lead-capture-webhook (GHL + Zapier)
  +--> Navigate to /book/sqft
```

