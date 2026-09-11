# Contractor account setup

Six steps, in this order:

1. **Sign the contractor agreement** — the Independent Contractor Agreement, with a signature.
2. **Verify your phone number** — dispatch has to be able to reach them.
3. **Check off your supplies** — what kit do they already own?
4. **Agree to the dress code** — the graphic, with an explicit agree tick. Viewing is not enough.
5. **Read the job-day journey** — what a job looks like from offer to payout.
6. **Watch the training videos** — all seven walkthroughs on the training hub. Skipping does not count.

A contractor with zero completed jobs **cannot be offered a first job** until every step is done, including the videos. People who have already completed a job are past this gate — we do not yank offers from the roster.

Payouts (Stripe) stay on the dashboard. They are how we pay, not how someone becomes eligible for work.

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

First-job eligibility is `isCleanerReadyForFirstJob()` in the same file,
mirrored in `supabase/functions/_shared/first-job-ready.ts` and
`public.cleaner_ready_for_first_job()`. Dispatch, broadcast, suggested
assignees, and offer-accept all use that gate. An admin who picks a
specific contractor can still assign them.

The database agrees too. `mint_cleaner_setup_token` returns `NULL` to mean
"nothing left to send", and `cleaner_setup_status_v1.setup_complete` reports
standing; both count all six steps
(`supabase/migrations/20260911220636_onboarding_agreement_first_training_gate.sql`).

## The two graphics

`src/lib/cleaner-onboarding-guides.ts` defines them. The files live in
`public/onboarding/` because they are content, not code — replacing one is
dropping in a new file, with no build change:

| Guide | File | What they have to do |
| --- | --- | --- |
| Dress code | `public/onboarding/dress-code.png` | Tick agree, then confirm |
| Job day, start to finish | `public/onboarding/job-day-journey.png` | Confirm they have read it |

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

Dress code and job-day are separate records (`ob_dress_code_ack` and
`ob_job_day_guides_ack`). A contractor who acknowledged the old combined
"guides" step is treated as having agreed to the dress code, so they are not
asked to tick a new box for the same picture.

## The supply checkoff counts on submission, not on readiness

A contractor who submits the checklist having ticked almost nothing has
**done the step**. Onboarding asks what they already have; it never waits on
them buying a vacuum.

Readiness is a separate, non-blocking signal: `SUPPLY_READY_PERCENT` (70%) of
the `neededForJob` items, surfaced to dispatch and shown on the meter as they
tick.

`ob_supplies_checklist_viewed` — the flag the older checklist page set — still
counts as a submission, so contractors who did this before
`supply_checklist_submitted_at` existed are not asked a second time.

## Training videos must be watched

The last portal card routes to `/cleaner/training`. Required content is the
seven catalog walkthroughs (`TOURS` in `src/lib/tours/catalog.ts`):

- Watch the recorded clip through to the end, **or**
- Run the live "Guide me" walkthrough and finish it.

Skipping a walkthrough does not count. `POST /api/cleaner/tours` stamps
`cleaners.ob_training_complete` when every catalog tour is `completed`.
Visiting the hub only sets `ob_training_accessed`.

The playbooks on that page are optional reference. They do not unlock a job.

Completion is still not an input to the Novara Score, pay, or ranking. It is
a yes/no eligibility fact for a first job.

## What happens when admin sends the link

`cleaner-admin-action` → `send_setup`:

```
mint_cleaner_setup_token
  → https://contractor.novaracleaning.com/cleaner/setup/<token>   (email + SMS)
  → /cleaner/auth?setup=<token>                                    (sign in / create login)
  → /cleaner/ob-portal                                             (the six steps)
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
contractor would see: six steps in order, agreement first, dress-code agree
required, training last, payouts not in the portal, and the training hub
requiring the seven videos. Every Supabase call is answered from an invented
fixture in the script, so no real contractor is touched. Screenshots land in
`docs/contractor-onboarding/` (gitignored — evidence of a run, not a source of
truth).

## Deliberately not built

- **No quiz on the job-day graphic.** Dress code requires an agree tick.
  Job-day is a read acknowledgment.
- **No supply approval step.** Nobody reviews or signs off what a contractor
  ticked. It is self-certified, and dispatch treats it as advisory — see
  `equipmentMatch()`, which shows the gap for commercial sites rather than
  filtering people out.
- **No separate pages inside the portal.** The agreement, guides and the
  checkoff are rendered inline. Training is the one step that routes out, to
  the hub where the videos actually play.
- **Admin exact-assign still works.** Automatic dispatch and broadcast do not
  offer unfinished contractors; a human who picks a name can still assign.
