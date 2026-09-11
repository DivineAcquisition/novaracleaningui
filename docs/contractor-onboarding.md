# Contractor account setup

Four steps, in this order:

1. **Verify your phone number** — dispatch has to be able to reach them.
2. **Read the dress code and job-day guide** — two graphics: what to wear, and
   what a job day looks like from offer to payout.
3. **Check off your supplies** — what kit do they already own?
4. **Set up payouts (Stripe)** — bank details and tax identity.

Payouts is last on purpose. It is the step with the most friction and the one
a contractor is most likely to walk away from, so it is only asked once the
cheap steps are behind them.

The guides sit before the supply checkoff because they are what makes the
checkoff make sense: you cannot usefully answer "what kit do you own" until
you have seen what a job actually asks of you.

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
standing; both count all four steps
(`supabase/migrations/20260912093000_onboarding_job_day_guides.sql`, which
supersedes `20260911200210_setup_sequence_includes_supplies.sql`). Without
that, a contractor who had done phone and Stripe but had never been asked
about the dress code or their supplies would look finished to the token
minter, and admin could not send them a setup link at all.

## The two graphics

`src/lib/cleaner-onboarding-guides.ts` defines them. The files live in
`public/onboarding/` because they are content, not code — replacing one is
dropping in a new file, with no build change:

| Guide | File |
| --- | --- |
| Dress code | `public/onboarding/dress-code.png` |
| Job day, start to finish | `public/onboarding/job-day-journey.png` |

Each guide also carries its content as text in `points`. That is not
decoration:

- it is what a screen reader gets;
- it is what renders if the image cannot load, so a missing or blocked asset
  degrades to something readable instead of a broken box in the middle of
  onboarding;
- it is always available behind a "… as text" disclosure, for anyone who would
  rather read than squint at a diagram on a phone.

`npm run onboarding:verify` warns — rather than fails — when a graphic is not
in the repo, because the step still asks and answers the same question without
it. The warning is there so a missing file is visible rather than quietly
degrading forever.

One acknowledgment (`cleaners.ob_job_day_guides_ack`) covers both graphics.
Splitting the record would let a contractor sit half-acknowledged forever with
nothing able to describe that state usefully.

### Adding this step was retroactive on purpose

Every contractor who onboarded before this is now one step short, because none
of them have seen the dress code. That is the point — the graphic is new
policy material, and the setup link is how they get asked. Nothing about their
pay, jobs or Stripe standing changes.

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
  → /cleaner/ob-portal                                             (the four steps)
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
contractor would see: four steps in order, payouts locked until the first
three are done, both graphics rendering, the text fallback appearing when an
image is blocked, the acknowledgment and the checklist saving, and each step
flipping to complete. Every Supabase call is answered from an invented fixture
in the script, so no real contractor is touched. Screenshots land in
`docs/contractor-onboarding/` (gitignored — evidence of a run, not a source of
truth).

## Deliberately not built

- **No hard gate.** Nothing in the portal blocks a contractor from viewing
  jobs or working while setup is outstanding. The dashboard links to the
  portal; it does not trap them in it.
- **No quiz or attestation on the guides.** One "I've read both" button. The
  dress code is also part of the contractor standards acknowledgment, which is
  where a signature belongs; repeating it here would be theatre.
- **No supply approval step.** Nobody reviews or signs off what a contractor
  ticked. It is self-certified, and dispatch treats it as advisory — see
  `equipmentMatch()`, which shows the gap for commercial sites rather than
  filtering people out.
- **No separate pages inside the portal.** The guides and the checkoff are
  rendered inline by components the other surfaces share
  (`src/components/cleaner/JobDayGuides.tsx`,
  `src/components/cleaner/SupplyChecklistForm.tsx`), so there is one of each
  and one save path, not two that drift.
