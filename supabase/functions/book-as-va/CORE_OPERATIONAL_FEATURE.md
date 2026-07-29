# CORE OPERATIONAL FEATURE — Internal Booking (`book-as-va`)

**This function is how Novara takes money. If it breaks, the business stops.**
Treat every change here as production-critical. Read this file before editing
`index.ts` or anything it imports.

---

## The rule

**Once the `bookings` row is written, the request MUST return 200.**

Everything after the insert — GHL contact/opportunity, GHL calendar appointment,
Stripe customer, Stripe invoice, pay page token, confirmation email, checklist
email, referral code, confirmation SMS — is a *side effect*. Every one of them is
allowed to fail. **None of them may throw the request away.**

Wrap each one and record a warning:

```ts
try { await sideEffect(); } catch (e) { noteFailure("Step name", e); }
```

and return them to the caller as `warnings: string[]` alongside `success: true`.

## Why this rule exists

On 2026-07-29 the deposit-invoice path failed like this:

1. Booking row committed ✔
2. `stripe.invoiceItems.create()` succeeded ✔
3. `stripe.invoices.create()` threw — Stripe had started rejecting
   `payment_settings.payment_method_options.card.setup_future_usage`
4. The Stripe block had **no try/catch**, so the whole function returned 500

The operator saw "booking failed", pressed submit again, and again. Result:

- **3 duplicate confirmed bookings** for one job (NVC-0040/41/42)
- **3 orphaned Stripe invoice items** ($87.50 each) left dangling on the
  customer, which would have silently ridden onto their next invoice
- 3 duplicate checklist emails to the customer, sent by a DB trigger on insert
- The real error was invisible; the failure looked like the booking never saved

A booking that exists must never be reported as a booking that failed. That
single inversion is what turned a recoverable missing-invoice into duplicated
jobs and a mis-billed customer.

## Non-negotiables

1. **No unguarded `await` after the booking insert.** If you add a step, wrap it.
2. **Never fail the request for a payment artifact.** A missing invoice is
   recoverable — an admin can resend it. A lost or duplicated booking is not.
3. **Surface the reason.** The 500 handler returns `{ error }`; the success path
   returns `{ warnings }`. Silent failure is what made this expensive to find.
4. **Every payment option is a separate code path — test all of them.**
   `deposit_plus_remaining`, `deposit_plus_preauth`, `full_now`, `none`. The
   pre-auth path never touches Stripe Invoices, which is exactly why the invoice
   bug hid for weeks: day-to-day bookings used pre-auth and looked healthy.
5. **Prefer static imports.** A relative `await import()` resolves at runtime and
   fails inside the request instead of at deploy.
6. **Stripe params are version-sensitive.** The SDK pins an `apiVersion`. A field
   that is valid on one Stripe resource is often invalid on another — verify
   against the live API before shipping, not by analogy.

## Before you ship a change here

- [ ] Every post-insert step is inside a `try/catch`
- [ ] Exercised all four `invoiceMode` values
- [ ] Confirmed no orphaned Stripe objects are left behind on failure
- [ ] Confirmed a failing side effect still returns 200 with a warning
