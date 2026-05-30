# Admin overhaul — 2026-05-30 deployment notes

This PR is a large, multi-system overhaul. Most of it works out of the box
on the existing Supabase project, but two integrations need credentials
added before they light up. Drop them in **Cursor Dashboard → Cloud Agents
→ Secrets** (or directly into `public.app_secrets` via SQL) and re-deploy
any affected edge functions.

## Required new secrets

| Secret | What it does | Where to get it |
|--------|--------------|-----------------|
| `APPLOYE_API_KEY` | Bearer token for the Apploye Public API. Powers `apploye-invite-cleaner`, `apploye-live-tracking`, and the admin Map's live-GPS overlay. | Apploye Settings → API Tokens → "Generate". |
| `APPLOYE_WORKSPACE_ID` | Numeric workspace id Apploye scopes every call by. | Apploye URL when you're inside the workspace (`/workspaces/<id>/…`) or via Apploye Support. |
| `APPLOYE_API_BASE` *(optional)* | Override of the API base URL. Leave blank for `https://www.apploye.com/api/v1`. | Only set if Apploye reshapes the endpoint surface. |

Already-present secrets the new flows lean on (no action needed, but documented for completeness):
- `STRIPE_SECRET_KEY` — used by `book-as-va` for the new `deposit_plus_preauth` Stripe Checkout Session.
- `GHL_PIT_TOKEN` + `GHL_LOCATION_ID` — used by the admin Messages → Conversations panel + the dispatch broadcast.
- `RESEND_API_KEY` — used by the existing email senders.

## What lights up automatically (no secrets required)

- ✅ Pricing v4 reset across customer + VA bookings (15% std / 25% deep / 50% std-portion of combo). Promo codes deactivated.
- ✅ Admin → Bookings tab default filter switched to "All bookings", ordered by `created_at DESC`.
- ✅ Internal VA booking: only one Stripe invoice at booking time. The day-of remaining invoice is mailed by the new pg_cron job `send-remaining-day-of` (11:30 UTC daily).
- ✅ Internal VA booking: 4th payment option "Deposit + pre-auth hold" hosts a Stripe Checkout Session that collects deposit + saves card. The remaining is auto-captured by `complete-booking` after admin clicks Mark Completed.
- ✅ Internal VA referral SMS: unique per-customer link (server now resolves customer by email and pre-mints `referral_code`).
- ✅ Dispatcher: switched to `send-ghl-sms` for job-offer SMS. Falls back to "broadcast to all active cleaners" when zero candidates pass scoring. First-to-claim race handled by `accept-job-offer`.
- ✅ Admin → Cleaners → Add cleaner → "Bypass onboarding (phone verify)" tab. Sends a 6-digit code via GHL; verifying it flips the cleaner to active/approved/dispatch-ready in one step.
- ✅ Admin → Messages: "GHL Conversations (2-way)" panel — read recent threads, reply via GHL.
- ✅ Post-completion cleaner photo SMS — `complete-booking` mints a token, SMSes a `/cleaner/job-photos/<token>` link, photos land in the public `cleaner-job-photos` Storage bucket.

## What's wired but inert until Apploye creds are set

- ⚠️ Admin → Cleaners → "Invite to Apploye" button (returns a friendly "not configured yet" toast).
- ⚠️ Admin → Map: Apploye GPS overlay + side strip (shows a configure-secrets banner until `APPLOYE_API_KEY` is set).
- ⚠️ Contractor portal time-tracking UX (cleaners install the Apploye app from the invite email; live pings flow back through `apploye-live-tracking`).

## Migrations applied

- `20260530_pricing_v4_reset` — `pricing_config` one-time bases + `promo_codes.active=false`.
- `20260530_day_of_invoice_cron` — pg_cron `send-remaining-day-of` (11:30 UTC).
- `20260530_bypass_onboarding_and_dispatch_broadcast` — `cleaner_verification_codes.cleaner_id`/`consumed`/`consumed_at`.
- `20260530_cleaner_photo_upload_token` — `bookings.photo_upload_token`+ Storage bucket policies.
- `20260530_apploye_integration` — `cleaners.apploye_member_id` + secrets placeholders.

## Edge functions deployed / changed

| Function | Change |
|----------|--------|
| `book-as-va` | New `deposit_plus_preauth` mode, single-invoice cadence, shared pricing module, referral pre-mint, `customers.stripe_customer_id` sync. |
| `create-payment-intent` | Shared pricing module; promo + 50% referral discount neutralised. |
| `create-checkout` | Shared pricing module for the one-time line item. |
| `modify-booking` | Shared pricing module. |
| `ai-tool-router` | Shared pricing module. |
| `send-post-booking-sms` | Resolve customer by email first to fix the VA-flow referral link bug. |
| `dispatch-job` | GHL SMS, geocode retry, broadcast fallback when zero qualified cleaners. |
| `accept-job-offer` | First-to-claim race for broadcast jobs. |
| `cleaner-admin-action` | `bypass_onboarding_send_code` + `bypass_onboarding_verify_code`. |
| `complete-booking` | Photo-upload SMS to cleaner via GHL with single-use token. |
| `send-remaining-day-of` | NEW — day-of remaining-balance invoice sweeper. |
| `get-cleaner-photo-form` | NEW — token resolver for the public upload page. |
| `submit-cleaner-photos` | NEW — appends URLs to `bookings.before_photos`/`after_photos`. |
| `apploye-invite-cleaner` | NEW — invites a cleaner into the Apploye workspace. |
| `apploye-live-tracking` | NEW — returns live GPS pings joined with cleaners + bookings. |

## Known follow-ups (deferred from this PR)

- Service checklists normalization (Standard / Deep / Move-In/Out / Combo should share a structural template). The checklist email already exists per-service; this is a content audit that needs product input.
- Full contractor app shell (bottom nav: Jobs / Time Clock / Map / Profile). The current `/contractor/jobs` flow stays unchanged; the Apploye scaffold is the foundation the future shell will lean on.
- GHL inbound webhook: outbound from the admin Messages tab is live; verify the inbound webhook still routes customer replies into our DB so the polling fallback isn't the only source of truth.

## Recommendation for the env-setup agent

> Run the env-setup agent at https://cursor.com/onboard with the prompt:
> "Please add `APPLOYE_API_KEY` and `APPLOYE_WORKSPACE_ID` to the Cloud-Agent
> secrets so all future agents can call Apploye without prompting. Read the
> values from the Apploye Settings → API Tokens dashboard. Optional:
> `APPLOYE_API_BASE` if the API URL ever changes from the default."
