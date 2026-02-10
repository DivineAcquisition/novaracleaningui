

# Include Referral Code in Test Data + Standardize $18/hr Default

## Overview
Two changes: (1) create a customer record for the test booking email so the webhook payload includes a referral code/link, and (2) fix a fallback in the admin cleaner selector that incorrectly defaults to $20/hr instead of $18/hr.

## Changes

### 1. Insert a Customer Record with Referral Code
Create a migration to insert a `customers` row for `test-webhook@novaracleaning.com` with a referral code (e.g., `TESTREF50`). This ensures the `send-zapier-webhook` function finds it and includes:
- `"Customer Referral Code": "TESTREF50"`
- `"Referral Link": "https://try.novaracleaning.com/book?ref=TESTREF50"`

Then re-trigger the webhook with the existing test booking ID to send the updated payload.

### 2. Fix $20/hr Fallback to $18/hr
In `src/components/admin/CleanerMultiSelect.tsx`, two lines use `|| 20` as the fallback for `pay_rate_hr`. These should be `|| 18` to match the standardized $18/hr rate:
- Line 53: `hourlyRate: cleaner.pay_rate_hr || 20` changes to `|| 18`
- Line 200: `${cleaner.pay_rate_hr || 20}/hr` changes to `|| 18`

### 3. Re-send Test Webhook
After inserting the customer record, re-invoke `send-zapier-webhook` with the existing test booking ID to confirm the referral code and link appear in the payload sent to GHL and Zapier.

## Files Modified
- **New migration** -- INSERT into `customers` table
- **`src/components/admin/CleanerMultiSelect.tsx`** -- Fix two `|| 20` fallbacks to `|| 18`

