
# Autonomous Cleaner Enrollment and Job Assignment System

## What This Solves
Right now, adding cleaners and assigning them to jobs requires manual admin intervention. As your cleaner pool grows, this won't scale. This plan creates two things:

1. **A public webhook** that external systems (Zapier, GHL, Google Forms, etc.) can call to auto-enroll cleaners
2. **A self-enrollment page** where cleaners can sign up on their own without admin involvement
3. **Tightening the auto-dispatch pipeline** so jobs flow to cleaners without manual steps

## Current State (What Already Works)
- `dispatch-job` -- sophisticated scoring algorithm (location, rating, workload, performance) that assigns cleaners to jobs
- `auto-dispatch-booking` -- creates a job from a booking and calls `dispatch-job`
- `stripe-webhook` -- triggers `auto-dispatch-booking` after payment succeeds
- `assign-cleaner` -- simpler ZIP-based round-robin assignment (legacy, also triggered by stripe-webhook)
- Cleaner onboarding wizard at `/cleaner/onboarding` (requires auth)

## Current Gaps
1. **No inbound webhook exists** for programmatic cleaner creation from external systems
2. **Duplicate dispatch calls** -- stripe-webhook calls BOTH `auto-dispatch-booking` AND `assign-cleaner`, causing double assignment attempts
3. **Self-enrollment requires admin approval** -- the onboarding form sets `approved: true` but geocoding (home_lat/lng) isn't done, so `dispatch-job` skips these cleaners (it filters on `not home_lat is null`)
4. **No geocoding on cleaner signup** -- cleaners enter a ZIP code but lat/lng is never calculated, making them invisible to the distance-based dispatch algorithm

## Plan

### 1. Create Inbound Webhook: `enroll-cleaner`
A new edge function at `supabase/functions/enroll-cleaner/index.ts` that external systems can POST to.

**Authentication**: Secret key in header (`x-webhook-secret`) matched against a new `CLEANER_ENROLLMENT_WEBHOOK_SECRET` Supabase secret.

**Accepts**:
```text
{
  "email": "jane@example.com",       (required)
  "first_name": "Jane",              (required)
  "last_name": "Doe",                (required)
  "phone": "5551234567",             (required)
  "state": "MD",                     (optional)
  "home_zip": "21201",               (optional)
  "service_zip_codes": ["21201"],    (optional)
  "max_travel_miles": 20,            (optional, default 20)
  "preferred_work_days": ["Mon","Tue"], (optional)
  "skillset": ["Standard Cleaning"], (optional)
  "pay_rate_hr": 18                  (optional, default 18)
}
```

**Logic**:
- Validate required fields (email, name, phone)
- Check for duplicate by email -- skip if already exists (return existing cleaner ID)
- Create Supabase auth user with auto-generated password (same pattern: `{firstInitial}{lastName}nv2025!`)
- Create cleaner record with `approved: true`, `status: "active"`, `onboarding_complete: true`
- Geocode home_zip to populate `home_lat`/`home_lng` (calls existing `geocode-address` function)
- Return cleaner ID and generated credentials
- Log enrollment to a simple audit trail

**Config**: `verify_jwt = false` (uses secret key auth instead)

### 2. Auto-Geocode Cleaners on Self-Enrollment
Update `src/pages/cleaner/Onboarding.tsx` to geocode the cleaner's home ZIP after profile creation.

After the cleaner record is inserted, call the `geocode-address` edge function with the ZIP code, then update the cleaner record with `home_lat` and `home_lng`. This ensures self-enrolled cleaners are immediately visible to the dispatch algorithm.

### 3. Fix Duplicate Dispatch in Stripe Webhook
Update `supabase/functions/stripe-webhook/index.ts` to remove the redundant `assign-cleaner` call.

Currently at line ~312, after `auto-dispatch-booking` already runs (line ~190), the webhook ALSO calls `assign-cleaner` (line ~315). This creates competing assignment logic. Remove the `assign-cleaner` block since `auto-dispatch-booking` -> `dispatch-job` is the more sophisticated pipeline.

### 4. Add Secret for Webhook Authentication
Add a new Supabase secret: `CLEANER_ENROLLMENT_WEBHOOK_SECRET` -- a random string that external systems must include in their requests.

### 5. Update `supabase/config.toml`
Add the new function entry:
```toml
[functions.enroll-cleaner]
verify_jwt = false
```

## File Changes Summary

| File | Action | Purpose |
|---|---|---|
| `supabase/functions/enroll-cleaner/index.ts` | Create | New inbound webhook for auto-enrolling cleaners |
| `supabase/config.toml` | Edit | Add `enroll-cleaner` function config |
| `src/pages/cleaner/Onboarding.tsx` | Edit | Add geocoding after profile creation |
| `supabase/functions/stripe-webhook/index.ts` | Edit | Remove duplicate `assign-cleaner` call |

## How It All Works End-to-End

```text
CLEANER ENROLLMENT (two paths):

Path A: External System (Zapier/GHL/Form)
  POST /enroll-cleaner + x-webhook-secret header
    -> Validates fields
    -> Creates auth user + cleaner record
    -> Geocodes ZIP -> lat/lng
    -> Cleaner immediately available for dispatch

Path B: Self-Enrollment (contractor.novaracleaning.com)
  Cleaner visits /cleaner/onboarding-landing
    -> Email verification
    -> 4-step wizard
    -> Profile saved + geocoded
    -> Stripe Connect setup
    -> Cleaner immediately available for dispatch

JOB ASSIGNMENT (fully autonomous):

Customer pays for booking
  -> Stripe webhook fires
  -> auto-dispatch-booking creates job record
  -> dispatch-job scores all eligible cleaners
     (location, rating, workload, performance)
  -> Creates job_assignments for top candidates
  -> Sends SMS offers to cleaners
  -> Cleaners accept/decline via SMS link
```
