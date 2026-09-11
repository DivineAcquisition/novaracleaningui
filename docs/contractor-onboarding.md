# Contractor account setup

Three steps, in this order:

1. **Verify your phone number** — dispatch has to be able to reach them.
2. **Check off your supplies** — what kit do they already own?
3. **Set up payouts (Stripe)** — bank details and tax identity.

Payouts is last on purpose. It is the step with the most friction and the one
a contractor is most likely to walk away from, so it is only asked once the
two cheap steps are behind them. The supply checkoff in the middle is also the
step that tells dispatch something immediately useful, which makes it worth
asking before the hard one.

## One definition, four readers

`cleanerSetupSteps()` in `src/lib/cleaner-supplies.ts` is the sequence. Four
things read it, and before it existed each of them decided the order — and
what "complete" meant — for itself:

| Reader | What it uses the sequence for |
| --- | --- |
| `src/views/cleaner/OnboardingPortal.tsx` | The steps a contractor works through |
| `src/app/api/cleaner/setup/[token]/route.ts` | What a mailed link reports as outstanding |
| `src/views/cleaner/SetupContinue.tsx` | Renders that list, in that order |
| `src/views/admin/Cleaners.tsx` | Whether setup is incomplete, and the progress % |

The database agrees too. `mint_cleaner_setup_token` returns `NULL` to mean
"nothing left to send", and `cleaner_setup_status_v1.setup_complete` reports
standing; both count all three steps
(`supabase/migrations/20260911190000_setup_sequence_includes_supplies.sql`).
Without that migration, a contractor who had done phone and Stripe but had
never been asked about supplies would look finished to the token minter, and
admin could not send them a setup link at all.

## The supply checkoff counts on submission, not on readiness

A contractor who submits the checklist having ticked almost nothing has
**done the step**. Onboarding asks what they already have; it never waits on
them buying a vacuum.

Readiness is a separate, non-blocking signal: `SUPPLY_READY_PERCENT` (70%) of
the `neededForJob` items, surfaced to dispatch and shown on the meter as they
tick. A contractor below the threshold still finishes onboarding, still gets
offers, and still gets paid.

`ob_supplies_checklist_viewed` — the flag the older checklist page set — still
counts as a submission, so contractors who did this before
`supply_checklist_submitted_at` existed are not asked a second time.

## What happens when admin sends the link

`cleaner-admin-action` → `send_setup`:

```
mint_cleaner_setup_token
  → https://contractor.novaracleaning.com/cleaner/setup/<token>   (email + SMS)
  → /cleaner/auth?setup=<token>                                    (sign in / create login)
  → /cleaner/ob-portal                                             (the three steps)
```

The email and the SMS both list what is outstanding in portal order, so the
message, the landing page, and the portal say the same thing. The link is
valid for 14 days and is re-mintable — sending again is safe.

There is also a supplies-only link (`send_supplies` →
`/cleaner/supplies/<token>`, no login) for a contractor who has finished
everything else. Both routes write the same columns
(`supplySubmissionPatch()`), so someone who starts on the emailed link and
finishes in the portal is never asked twice.

## Verifying it

```bash
npm run dev -- --port 3100     # in another shell
npm run onboarding:verify
```

`scripts/verify-onboarding-sequence.ts` checks the shared definition by
calling it, then opens the real pages in a browser and reads what a
contractor would see: three steps in order, payouts locked until the first
two are done, the checklist submitting, and the step flipping to complete.
Every Supabase call is answered from an invented fixture in the script, so no
real contractor is touched. Screenshots land in `docs/contractor-onboarding/`
(gitignored — evidence of a run, not a source of truth).

## Deliberately not built

- **No hard gate.** Nothing in the portal blocks a contractor from viewing
  jobs or working while setup is outstanding. The dashboard links to the
  portal; it does not trap them in it.
- **No supply approval step.** Nobody reviews or signs off what a contractor
  ticked. It is self-certified, and dispatch treats it as advisory — see
  `equipmentMatch()`, which shows the gap for commercial sites rather than
  filtering people out.
- **No separate supplies page inside the portal.** The checkoff is rendered
  inline as step 2 by the same component the emailed link uses
  (`src/components/cleaner/SupplyChecklistForm.tsx`), so there is one
  checklist and one save path, not two that drift.
