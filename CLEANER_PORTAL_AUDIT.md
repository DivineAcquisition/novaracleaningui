# Cleaner/Contractor Portal - Comprehensive Audit

**Audit Date:** 2026-03-17
**Branch:** `cursor/next-js-framework-migration-80d3`

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [File-by-File Analysis](#file-by-file-analysis)
3. [Cross-Cutting Concerns](#cross-cutting-concerns)
4. [Critical Issues](#critical-issues)
5. [Recommendations](#recommendations)

---

## Executive Summary

The cleaner/contractor portal consists of **20 files** across 3 layers: views (5), components (7), and edge functions (8). The portal covers authentication, onboarding, dashboard, job management, payments, and dispatch.

### Key Findings

| Area | Status | Severity |
|------|--------|----------|
| Phone verification in onboarding | **NOT INTEGRATED** | Critical |
| Job completion marking (cleaner-side) | **NOT IMPLEMENTED** | Critical |
| Google Calendar integration | Backend only, no cleaner UI | Medium |
| Google Address Autocomplete | **NOT INTEGRATED** in cleaner flows | Medium |
| Dashboard is a shell | Missing all job/stats components | Critical |
| MobileDashboard exists but is unreachable | No route wired | Critical |
| Two parallel verification systems | Confusing, inconsistent | High |
| Edge function name mismatches | Functions called don't match edge function names | Critical |

---

## File-by-File Analysis

---

### 1. `/workspace/src/views/cleaner/Onboarding.tsx` (725 lines)

**What it does:** 4-step wizard for new cleaner profile creation. Steps: Personal Info -> Location -> Availability/Skills -> Review. On submit, it creates a `cleaners` record, geocodes the ZIP, initiates Stripe Connect, and redirects to Stripe.

**Issues:**

- **NO PHONE VERIFICATION:** Phone number is collected (Step 1) but never verified via SMS. The phone field is a plain text input with no verification dialog or flow. The `PhoneVerificationDialog` component exists but is **not imported or used here**.
- **NO GOOGLE ADDRESS AUTOCOMPLETE:** Location step (Step 2) only collects state and ZIP code via dropdowns/inputs. No address autocomplete, no street address field, and no Google Places integration.
- **Hardcoded pay rate:** `pay_rate_hr: 18.00` is hardcoded in the insert (line 254). Should come from config or admin settings.
- **`approved: true` on creation:** Line 257 auto-approves cleaners on signup. This bypasses any admin approval workflow.
- **`onboarding_complete: true` on creation:** Line 258 marks onboarding complete immediately, even though the Onboarding Portal (`OnboardingPortal.tsx`) has 5 additional required steps (agreement, Discord, supplies, payouts, training). This is contradictory.
- **No email validation during onboarding:** Email comes from auth session but is never re-validated for the cleaner context.
- **`geocode-address` edge function** is called but not in the audited files list — may or may not exist.
- **No duplicate check before insert:** Relies on DB unique constraint (23505) rather than checking proactively.

---

### 2. `/workspace/src/views/cleaner/Dashboard.tsx` (333 lines)

**What it does:** Minimal dashboard showing: profile header, welcome card, Stripe Connect status, link to Onboarding Portal, pay rate display, and profile summary (email + phone).

**Issues:**

- **MISSING ALL JOB COMPONENTS:** The dashboard does NOT import or render `UpcomingJobs`, `CompletedJobs`, `DashboardStats`, `EarningsPayouts`, or `OnboardingChecklist`. These components all exist but are completely unused on this page.
- **No job list at all:** A cleaner visiting their dashboard sees zero information about upcoming or past jobs.
- **No check-in/check-out UI:** There is no way for a cleaner to check in or out of a job from this dashboard. The `job-check-in` edge function exists but has NO frontend caller in any cleaner view.
- **No job completion marking:** Cleaners cannot mark jobs as complete. The `complete-booking` edge function is admin-only.
- **`MobileDashboard.tsx` exists but is not routed:** There is a fully-built `MobileDashboard.tsx` in `src/views/cleaner/` that imports and uses `DashboardStats`, `OnboardingChecklist`, `ProfileCompletionWizard`, and `UpcomingJobs`, but it has NO corresponding route in `src/app/cleaner/`. The actual dashboard route (`/cleaner/dashboard`) points to the bare-bones `Dashboard.tsx`.
- **No real-time updates:** No subscription to job assignments or status changes.
- **`create-stripe-login-link` edge function** is called but not in audited files.

---

### 3. `/workspace/src/views/cleaner/Auth.tsx` (400 lines)

**What it does:** Authentication page with Google OAuth and email/password sign-in/sign-up tabs. Routes to onboarding or dashboard based on cleaner profile status.

**Issues:**

- **No connection to `OnboardingLanding.tsx`:** There's a separate `OnboardingLanding.tsx` that provides email-code-based auth (using `send-cleaner-verification-code` / `verify-cleaner-code`), but `Auth.tsx` is the standard email/password + Google OAuth flow. These are two parallel, disconnected auth systems with no cross-links between them.
- **"Forgot password?" links to `/cleaner/reset-password`** — this route exists in the file system.
- **Password minimum is only 6 characters** — weak by modern standards.
- **No CAPTCHA or brute-force protection** on the sign-in form.
- **Shared email/password state across tabs:** The sign-in and sign-up tabs share the same `email` and `password` state variables, so switching tabs preserves input. This is intentional UX but could cause confusion.

---

### 4. `/workspace/src/views/cleaner/AuthCallback.tsx` (110 lines)

**What it does:** Handles OAuth redirect after Google sign-in. Checks for cleaner profile and routes to dashboard (if onboarded) or onboarding (if new/incomplete).

**Issues:**

- **Retry logic is fragile:** Uses a hard 1-second `setTimeout` to wait for auth state to settle (line 42). This is a race condition that could fail on slow connections.
- **No handling for the case where Google OAuth fails silently** — if the URL hash doesn't contain tokens, the user sees a spinner indefinitely before the 1-second retry kicks in.
- Otherwise solid for its purpose.

---

### 5. `/workspace/src/views/cleaner/OnboardingPortal.tsx` (1195 lines)

**What it does:** Post-registration onboarding checklist with 5 sequential steps: (1) Sign Contractor Agreement, (2) Join Team Discord, (3) Review Supplies Checklist, (4) Setup Payouts via Stripe, (5) Access Training Portal.

**Issues:**

- **Contradicts `Onboarding.tsx`:** The main onboarding flow sets `onboarding_complete: true` immediately on profile creation, but this portal tracks 5 additional required steps. Cleaners are marked "complete" before doing any of these steps.
- **DB field naming confusion:** The step for "Join Team Discord" stores its state in `ob_google_chat_joined` / `ob_google_chat_joined_at`. The field names reference "Google Chat" but the UI is Discord. This is a migration artifact that creates confusion.
- **No phone verification step:** Phone verification is not one of the 5 onboarding steps. It's completely absent from the portal flow.
- **Agreement signing is honor-system:** The agreement step opens an external URL and then asks the user to self-certify they signed it. There's no backend verification that the document was actually completed.
- **Training portal URL (`https://training.novaracleaning.com`)** is marked as step complete the instant the button is clicked, before the user does any training.
- **Sequential locking:** Steps must be completed in order (step N blocks until step N-1 is done). This is good UX.
- **Blocked status screen** properly prevents fired/suspended cleaners from accessing the portal.
- **Supplies checklist** is comprehensive and includes a downloadable text file.

---

### 6. `/workspace/src/components/cleaner/UpcomingJobs.tsx` (84 lines)

**What it does:** Renders a list of upcoming job assignments with date, address, estimated pay, and a "Get Directions" button linking to Google Maps.

**Issues:**

- **UNUSED:** Not imported in the active `Dashboard.tsx`. Only referenced in `MobileDashboard.tsx` (which itself has no route).
- **No check-in button:** Comment on line 77 says "Check-in functionality can be added based on time window" but it's not implemented.
- **No job completion button:** No way to mark a job done.
- **`any[]` type for jobs:** No TypeScript interface for the job data structure.
- **Missing features:** No cancel/decline button, no contact customer button, no notes field.

---

### 7. `/workspace/src/components/cleaner/CompletedJobs.tsx` (85 lines)

**What it does:** Displays completed jobs with service type, customer name, payout amount, date, address, payout status badge, and whether the customer left a rating.

**Issues:**

- **UNUSED:** Not imported in any active view. Only exists as a standalone component.
- **`any[]` type** — no TypeScript interface.
- **No pagination:** If a cleaner has hundreds of completed jobs, they all render at once.
- **No date filtering** — no way to view by month/week.

---

### 8. `/workspace/src/components/cleaner/DashboardStats.tsx` (92 lines)

**What it does:** Renders 4 stat cards: Total Earnings, Jobs Completed, Average Rating, Acceptance Rate.

**Issues:**

- **UNUSED in active Dashboard.** Only used in `MobileDashboard.tsx`.
- **Earnings in cents:** Input expects cents but display converts to dollars correctly.
- Otherwise well-structured.

---

### 9. `/workspace/src/components/cleaner/OnboardingChecklist.tsx` (187 lines)

**What it does:** A progress checklist widget showing 3 items: Stripe Connect, Phone Verification, and Set Availability. Includes the `PhoneVerificationDialog` for phone verification.

**Issues:**

- **UNUSED in active Dashboard.** Only used in `MobileDashboard.tsx`.
- **This is where phone verification lives** — but it's never rendered because the dashboard doesn't import it.
- **Different from OnboardingPortal:** This tracks 3 items (Stripe, Phone, Availability). The `OnboardingPortal.tsx` tracks 5 different items (Agreement, Discord, Supplies, Payouts, Training). These are two completely separate onboarding checklists with no overlap or coordination.
- **`check-cleaner-status` edge function** is called (line 51) but not in audited files.
- **Stripe completion detection** checks URL params (`?stripe=complete`) which is good.

---

### 10. `/workspace/src/components/cleaner/PhoneVerificationDialog.tsx` (159 lines)

**What it does:** Modal dialog that sends a 6-digit SMS verification code and verifies it. Uses `send-phone-verification` and `verify-phone-code` edge functions.

**Issues:**

- **Only reachable through `OnboardingChecklist`** which is itself unreachable (not rendered in any active view).
- **Function name mismatch:** Calls `send-phone-verification` but the edge function in `supabase/functions/send-phone-verification/` exists and works correctly. However, this is a DIFFERENT system from `send-cleaner-verification-code` (which sends EMAIL codes, not SMS).
- **No phone number editing:** The dialog only sends to the phone already on file. If the phone number is wrong, the cleaner must edit their profile first (but there's no profile edit page).
- **Countdown timer** for resend (60 seconds) is correctly implemented.
- **Code state not cleared on close** — if user closes and reopens, stale state may persist.

---

### 11. `/workspace/src/components/cleaner/ProfileCompletionWizard.tsx` (447 lines)

**What it does:** A 3-step modal wizard: (1) Set Availability (status today, preferred days), (2) Service Areas (ZIP codes), (3) Profile Photo upload.

**Issues:**

- **UNUSED in active Dashboard.** Only used in `MobileDashboard.tsx`.
- **Third onboarding system:** This is yet another onboarding flow separate from `Onboarding.tsx` (4 steps) and `OnboardingPortal.tsx` (5 steps). Three different onboarding experiences exist with no unified coordination.
- **ZIP code-based service areas** are primitive compared to the radius-based system in `Onboarding.tsx` (which uses `max_travel_miles` + geocoding).
- **Sets `onboarding_complete: true` on step 3 completion** (line 172), duplicating the same flag set in `Onboarding.tsx`.
- **No Google Address Autocomplete** for service areas.
- **Dialog cannot be dismissed** (`onOpenChange={() => {}}`, line 211) — once opened, user must complete it.

---

### 12. `/workspace/src/components/cleaner/EarningsPayouts.tsx` (142 lines)

**What it does:** Table view of payout history with total paid out, processing amounts, per-payout rows with date/address/amount/status, and Stripe transfer links.

**Issues:**

- **COMPLETELY UNUSED.** Not imported anywhere in the codebase — not even in `MobileDashboard.tsx`.
- **`any[]` type** for payouts.
- **No pagination or date filtering.**
- **Stripe dashboard link** for individual transfers is a nice touch but links to admin Stripe dashboard, not the cleaner's Express dashboard.

---

### 13. `/workspace/supabase/functions/complete-booking/index.ts` (183 lines)

**What it does:** Admin-only function to mark a booking as completed. Updates status, triggers payout via `process-payout`, sends completion emails to both cleaner and customer, and fires a Zapier webhook.

**Issues:**

- **ADMIN ONLY:** Requires `user_roles` admin check. Cleaners cannot call this.
- **No cleaner-initiated completion:** There is no corresponding function or UI for a cleaner to mark their own job as complete.
- **Earnings calculation is rough:** `Math.round(booking.total_estimate_cents * 0.45)` — a 45% cut. This hardcoded percentage may not match actual cleaner pay rates.
- **Depends on `process-payout`** edge function (not audited).
- **Depends on `send-cleaner-email`** and `send-booking-email` (not audited).
- **Depends on `send-zapier-webhook`** (not audited).
- **No idempotency check:** Doesn't verify the booking isn't already completed before updating. Could double-trigger payouts if called twice.

---

### 14. `/workspace/supabase/functions/job-check-in/index.ts` (239 lines)

**What it does:** Handles check-in and check-out for job assignments. Tracks on-time arrivals (within 15 minutes of scheduled start), calculates actual duration on check-out, and updates cleaner stats.

**Issues:**

- **NO FRONTEND CALLER:** No cleaner-side UI calls this function. The `UpcomingJobs` component has a comment about adding check-in but it's not implemented.
- **Only called from admin views** (`Bookings.tsx`, `DispatchQueue.tsx`).
- **`lat`/`lng` parameters accepted but never used:** The function signature accepts geolocation data for check-in but never validates proximity to the job site.
- **On-time rate calculation bug:** Divides `total_on_time_arrivals` by `completed_bookings` (line 123), but `completed_bookings` may not be updated at check-in time, leading to incorrect rates.
- **Check-out doesn't trigger `complete-booking`:** Comment on line 212 says "could call complete-booking here" but doesn't.
- **No photo upload** for before/after job documentation.

---

### 15. `/workspace/supabase/functions/send-cleaner-verification-code/index.ts` (140 lines)

**What it does:** Generates a 6-digit code, stores it in `cleaner_verification_codes` table, and sends it via EMAIL (not SMS) using Resend. Used by `OnboardingLanding.tsx` for email-based auth.

**Issues:**

- **Misleading name:** Called "verification code" but it's specifically an EMAIL code system, not SMS/phone.
- **This is NOT the phone verification system.** `send-phone-verification` (a separate function) handles actual SMS.
- **No rate limiting** beyond what the DB insert provides.
- **Code stored in separate table** (`cleaner_verification_codes`) vs phone codes stored directly on the cleaner record. Inconsistent architecture.
- **Has a debug mode** (line 86) that returns HTML without sending — potential security concern if debug flag is user-controllable.
- **Uses React email rendering** via `renderAsync` — sophisticated but adds complexity.

---

### 16. `/workspace/supabase/functions/verify-cleaner-code/index.ts` (178 lines)

**What it does:** Verifies an email code, creates or finds user, generates a temporary password, signs in programmatically, and returns session tokens. This is the passwordless email auth system.

**Issues:**

- **Security concern:** Uses `listUsers()` on line 83 to search ALL users. This scales poorly and could timeout with many users.
- **Temporary password approach is fragile:** Creates a temp password, updates the user, then signs in with it. If the sign-in fails, the user's password has been changed to a random string they don't know.
- **Returns tokens directly in response body** — the client then calls `setSession()` with them. This is standard but the temp-password intermediate step is unusual.
- **No brute-force protection** on code verification attempts.
- **Single-use codes** are correctly implemented.

---

### 17. `/workspace/supabase/functions/create-google-calendar-event/index.ts` (211 lines)

**What it does:** Creates a Google Calendar event for a booking using a service account. Uses JWT-based auth with RSA signing, creates the event with booking details, and stores the event ID back on the booking.

**Issues:**

- **No cleaner-facing integration:** Cleaners never see or interact with Google Calendar events. This is an admin/backend function only.
- **Hardcoded timezone:** `America/New_York` (line 133, 138). Won't work correctly for cleaners in other timezones.
- **Time parsing relies on `time_slot` format:** Expects "HH:MM AM - HH:MM PM" format (line 112). If format varies, parsing breaks silently.
- **`convertTo24Hour` bug:** When `hours === '12'` it sets to `'00'`, then if PM, adds 12 to get 12. But for 12:00 AM, the result would be `'00:00'` which is correct. For 12:00 PM, hours becomes `'00'` then `12`. This is actually correct but fragile.
- **JWT base64 encoding:** Uses `btoa` which doesn't produce URL-safe base64. The payload might silently fail for certain booking data containing non-ASCII characters.
- **Event color hardcoded** to `'7'` (Peacock blue).

---

### 18. `/workspace/supabase/functions/update-google-calendar-event/index.ts` (265 lines)

**What it does:** Updates or deletes a Google Calendar event when a booking is rescheduled or cancelled. Same JWT auth approach as `create-google-calendar-event`.

**Issues:**

- **Massive code duplication:** The entire JWT generation logic (lines 62-105) is copy-pasted from `create-google-calendar-event`. Should be extracted to a shared module.
- **Same timezone hardcoding** (`America/New_York`).
- **Same `convertTo24Hour` function** duplicated.
- **Gracefully handles missing event IDs** — returns success if no event to update (line 45).
- **404 handling on delete** is correct (line 138) — treats already-deleted events as success.

---

### 19. `/workspace/supabase/functions/dispatch-job/index.ts` (470 lines)

**What it does:** Comprehensive auto-dispatch algorithm that: (1) filters cleaners by hard requirements (approved, active, location, capacity, conflicts), (2) scores them on 4 dimensions (location 0-30, rating 0-25, workload 0-25, performance 0-20), (3) selects top N candidates, (4) creates job assignments, (5) sends SMS notifications with accept/decline links.

**Issues:**

- **Well-architected scoring system.** This is the most sophisticated function in the portal.
- **SMS notification includes direct accept/decline URLs** pointing to `respond-to-offer` function.
- **Token is insecure:** `btoa(assignment.id).substring(0, 10)` (line 384) — this is just base64 of the assignment ID, trivially guessable. Anyone who knows an assignment ID can accept/decline it.
- **Hardcoded Supabase URL** in SMS message (line 385): `https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/respond-to-offer`. Should use env var.
- **15-minute response window** mentioned in SMS but not enforced in `respond-to-offer`.
- **`send-sms-notification`** dependency (not audited).
- **`update-cleaner-scores`** dependency (not audited).
- **`send-zapier-webhook`** dependency (not audited).
- **Dispatch alerts table** is used for monitoring — good operational practice.

---

### 20. `/workspace/supabase/functions/respond-to-offer/index.ts` (165 lines)

**What it does:** HTTP endpoint that handles accept/decline responses from SMS links. Updates assignment status, tracks acceptance metrics, and returns an HTML page confirming the action.

**Issues:**

- **Insecure token validation:** `btoa(assignmentId).substring(0, 10)` — same trivial token as dispatch. No HMAC, no signing, no expiration.
- **No time-based expiry:** The 15-minute response window from SMS is not enforced. A cleaner could accept hours later.
- **Returns HTML pages** (not JSON) — designed for direct browser access from SMS links. Good UX decision.
- **Hardcoded Supabase URL** in the response HTML (lines 58, 135).
- **Dashboard link points to Supabase URL** not the actual app URL. Cleaners would see raw Supabase, not their dashboard.
- **Double-counting prevention** for acceptance metrics is missing — if a cleaner somehow triggers the endpoint twice, `total_offers_received` increments twice.
- **`update-cleaner-scores`** called on accept but not on decline.

---

## Cross-Cutting Concerns

### Phone Verification Status

| Location | Integrated? | Details |
|----------|-------------|---------|
| `Onboarding.tsx` (main flow) | **NO** | Phone collected but never verified |
| `OnboardingPortal.tsx` (5-step portal) | **NO** | Not one of the 5 steps |
| `OnboardingChecklist.tsx` (widget) | YES | Has phone verification step |
| `PhoneVerificationDialog.tsx` | YES | Working dialog component |
| `MobileDashboard.tsx` | YES (via checklist) | But this page has no route |
| `Dashboard.tsx` (active) | **NO** | Doesn't import checklist |

**Verdict:** Phone verification exists as components and edge functions but is **completely unreachable** by cleaners through any active UI route.

### Job Completion Marking

| Component | Can cleaners mark jobs complete? |
|-----------|----------------------------------|
| `Dashboard.tsx` | No — no job list at all |
| `UpcomingJobs.tsx` | No — display only, no action buttons |
| `CompletedJobs.tsx` | Display only (post-completion) |
| `complete-booking` function | Admin-only |
| `job-check-in` function | Has check-out but no frontend caller |

**Verdict:** Cleaners have **NO way** to mark jobs as complete or check in/out. This is entirely an admin-side operation.

### Google Calendar Integration

| Component | Integrated? | Details |
|-----------|-------------|---------|
| `create-google-calendar-event` | Backend only | Creates events on booking creation |
| `update-google-calendar-event` | Backend only | Updates/deletes on reschedule/cancel |
| Cleaner Dashboard | **NO** | No calendar view, no event links |
| Cleaner Job Cards | **NO** | No "Add to Calendar" button |

**Verdict:** Google Calendar works server-side for admin scheduling but cleaners have **zero visibility** into calendar events.

### Google Address Autocomplete

| Component | Integrated? |
|-----------|-------------|
| `Onboarding.tsx` | **NO** — only ZIP + state dropdown |
| `ProfileCompletionWizard.tsx` | **NO** — ZIP code text input |
| `google-places-key` function | EXISTS but unused in cleaner flows |

**Verdict:** The `google-places-key` edge function exists to securely provide the API key, but **no cleaner-facing component uses Google Places Autocomplete**.

---

## Critical Issues (Priority Order)

### 1. Dashboard is a Shell
The active `Dashboard.tsx` renders almost nothing useful. 6 fully-built components (`UpcomingJobs`, `CompletedJobs`, `DashboardStats`, `EarningsPayouts`, `OnboardingChecklist`, `ProfileCompletionWizard`) exist but are unused. A complete `MobileDashboard.tsx` exists with proper data fetching but has no route.

**Fix:** Either route the dashboard page to `MobileDashboard.tsx` or integrate the components into `Dashboard.tsx`.

### 2. Phone Verification is Unreachable
Phone verification UI and backend both work but are wired into `OnboardingChecklist` → `MobileDashboard.tsx` → (no route). Cleaners are never asked to verify their phone.

**Fix:** Add phone verification to either `Onboarding.tsx` (step 1) or `OnboardingPortal.tsx` (as step 6), or route `MobileDashboard` so the checklist is visible.

### 3. No Check-in/Check-out or Job Completion UI
The `job-check-in` edge function is fully implemented but has zero frontend integration in any cleaner view. Cleaners cannot interact with their job assignments at all.

**Fix:** Add check-in/check-out buttons to `UpcomingJobs.tsx` and wire them to the `job-check-in` function.

### 4. Three Conflicting Onboarding Flows
- `Onboarding.tsx`: 4-step profile creation → sets `onboarding_complete: true`
- `OnboardingPortal.tsx`: 5-step checklist (agreement, Discord, supplies, payouts, training)
- `ProfileCompletionWizard.tsx`: 3-step modal (availability, ZIPs, photo)

These three flows set the same flag (`onboarding_complete`) and have no coordination. A cleaner is marked "complete" by `Onboarding.tsx` before ever seeing the agreement, Discord, or supplies steps.

**Fix:** `Onboarding.tsx` should NOT set `onboarding_complete: true`. That flag should only be set when all `OnboardingPortal` steps are done.

### 5. Insecure SMS Response Tokens
The dispatch system uses `btoa(assignmentId).substring(0, 10)` as a "token." This is trivially reversible and guessable — anyone who knows assignment IDs can accept/decline offers for any cleaner.

**Fix:** Use HMAC-signed tokens with expiration timestamps.

### 6. Two Disconnected Auth Systems
- `Auth.tsx`: Email/password + Google OAuth (standard Supabase auth)
- `OnboardingLanding.tsx`: Email code verification (passwordless, uses `send-cleaner-verification-code` / `verify-cleaner-code`)

These have no cross-links and create different user experiences. The `verify-cleaner-code` system creates users with random passwords, which means if those users try to use `Auth.tsx` later, they can't sign in with a password (they never set one).

**Fix:** Unify the auth flows or add a "set password" step after code verification.

### 7. Hardcoded URLs in Edge Functions
`dispatch-job` and `respond-to-offer` both hardcode the Supabase project URL (`sxdraeptzuamsgjcvfeg.supabase.co`). The "View Dashboard" link in `respond-to-offer` points to the Supabase URL, not the actual app.

**Fix:** Use `SUPABASE_URL` env var and add an `APP_URL` env var for frontend links.

---

## Recommendations

### Immediate (Blocking Issues)

1. **Route `MobileDashboard.tsx`** to `/cleaner/dashboard` (or merge its functionality into `Dashboard.tsx`). This single change would instantly surface stats, upcoming jobs, and the onboarding checklist (including phone verification).

2. **Fix `onboarding_complete` flag** in `Onboarding.tsx` — set it to `false` and let `OnboardingPortal.tsx` control when it becomes `true`.

3. **Add check-in/check-out buttons** to `UpcomingJobs.tsx` that call the `job-check-in` edge function.

4. **Add job completion flow** — either let cleaners mark jobs done (calling a new function) or make check-out automatically trigger `complete-booking`.

### Short-term (High Priority)

5. **Integrate Google Places Autocomplete** in `Onboarding.tsx` step 2 (Location) using the existing `google-places-key` edge function.

6. **Add phone verification** to the onboarding flow — either as a step in `Onboarding.tsx` or as a mandatory step in `OnboardingPortal.tsx`.

7. **Fix SMS response tokens** — implement HMAC-signed tokens with TTL.

8. **Remove `approved: true` auto-approval** from `Onboarding.tsx` and add admin approval workflow.

### Medium-term

9. **Consolidate onboarding flows** — merge `ProfileCompletionWizard` and `OnboardingPortal` into one unified post-signup experience.

10. **Add "Add to Calendar" buttons** in job cards for cleaner-side Google Calendar integration.

11. **Extract shared JWT logic** in Google Calendar functions into a shared module.

12. **Rename `ob_google_chat_joined`** DB fields to `ob_discord_joined` to match actual usage.

13. **Add pagination** to `CompletedJobs` and `EarningsPayouts`.

14. **Add TypeScript interfaces** to replace `any` types throughout components.

15. **Add profile edit page** — cleaners currently have no way to update their phone, address, or availability after onboarding.
