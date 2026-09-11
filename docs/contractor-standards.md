# Contractor Standards & Conduct Addendum

**Edition 1.0 · September 2026 · Acknowledged by every contractor**

The addendum sets out what performing the Services to a professional standard actually
requires on a job: appearance, phone reachability, working the checklist, client property,
pets, punctuality, chemicals, and self-reporting incidents. It does not create new
obligations — it makes the existing ones under the Independent Contractor Agreement specific
enough to coach against and, where it comes to that, enforce.

Every contractor acknowledges it. Existing contractors re-acknowledge; new contractors
acknowledge at onboarding.

**The text lives in [`src/lib/contractor-standards.ts`](../src/lib/contractor-standards.ts).**
It is not duplicated here, in a PDF, or in a DocuSeal template. Every surface that shows the
addendum — the texted acknowledgment page, the onboarding wizard, the admin preview — renders
that one module, so a contractor cannot acknowledge a document that differs from the one an
admin later enforces.

---

## Why this isn't shaped like the ICA

The Independent Contractor Agreement is a contract, signed once, and its schema says so:
`cleaners.ob_agreement_signed` is a boolean and `mint_cleaner_agreement_token` refuses outright
once it's true. Re-signing an executed agreement would put a second, contradictory document on
the record, so the flow is built to prevent it.

The addendum is the opposite case. It will be revised as new failure modes turn up, and each
revision has to be consented to again by people who already agreed to the previous one. So:

| | ICA | Standards addendum |
|---|---|---|
| Record | `ob_agreement_signed` boolean | `conduct_standards_version` string |
| Text lives in | DocuSeal template (ops-managed) | `src/lib/contractor-standards.ts` |
| Signed again? | Never | On every revision |
| Evidence | `docuseal_submissions` | `cleaner_conduct_acknowledgments` (append-only) |

**Never treat `conduct_standards_version` as a boolean.** A non-null value only means they
acknowledged *something*. Compare it against the current version, or use
`needsStandardsAcknowledgment()` / `standardsStanding()`, which do the comparison for you.

---

## How a contractor acknowledges

**New contractors** acknowledge inside the onboarding wizard, on the Review & Sign step. The
full document is shown inline, there is a separate consent checkbox from the ICA one, and
Finish stays disabled until it's ticked. One drawn signature covers both documents — they're
signed in one sitting.

If the acknowledgment write fails, onboarding still completes and the contractor is simply
recorded as owing an acknowledgment. That failure direction is deliberate: the worst outcome is
one extra text message, whereas stamping a version with no evidence behind it would leave us
with a record we couldn't stand behind.

**Existing contractors** get a texted and emailed link to
`contractor.novaracleaning.com/cleaner/standards/<token>`. No login, no wizard. The page shows
the whole document inline rather than as a PDF — this is read on a phone, and a pinch-to-zoom
PDF is a document nobody reads, which is exactly the defence the addendum exists to remove.

Two deliberate differences from the ICA signing link:

- **The token is not burned.** The standards are a reference document; the pet rule and the
  chemical rule are things you want to re-read from the same text message while standing in a
  client's kitchen. A repeat acknowledgment of a version already acknowledged is idempotent.
- **Having acknowledged an older version does not close the page.** It changes the ask from
  "please read this" to "we've revised this", on the page, in the email, and in the SMS.
  Telling somebody who did this in March to "please acknowledge" reads as a system that lost
  their answer, and they stop replying.

---

## Sending links

**Roster-wide.** `/admin/cleaners` shows a panel above the directory listing everyone who
hasn't acknowledged the current version, separated into never-acknowledged and
acknowledged-an-older-version, with active contractors first. One tap per person sends the
link. The panel hides itself when everyone is current.

**One contractor.** The Onboarding tab of the contractor panel has a **Send standards link**
card whenever they're behind, alongside the setup and agreement cards.

Both routes go through the `send_standards` action on the `cleaner-admin-action` edge function,
which mints a token, sends email + SMS, and hands the link back if both transports fail so an
admin can send it themselves. It refuses only when the contractor is already current.

---

## What gets recorded

`cleaner_conduct_acknowledgments` is append-only, one row per contractor per version, holding
the version, the timestamp, where it came from (`onboarding` / `standards_link` / `admin`),
the typed name, the drawn signature, and **the acknowledgment wording as it stood at the
time**. The wording is copied rather than referenced on purpose: the point of keeping old rows
is being able to read back what somebody agreed to, and a pointer into current code can't do
that once the current code has changed.

`cleaners.conduct_standards_version` and `conduct_standards_acknowledged_at` hold the latest
acknowledgment, denormalized so gating and directory rendering are a single column read.

`cleaner_conduct_standards_status_v1` computes each contractor's standing against the current
version. `working_unacknowledged` is the row that matters: an active, approved contractor going
into clients' homes without having acknowledged the current standards.

---

## Publishing a revision

Editing the words is not enough — a revision nobody re-acknowledged is no better than no
revision. All four steps, in one change:

1. Edit the sections in `src/lib/contractor-standards.ts`.
2. Bump `CONTRACTOR_STANDARDS_VERSION` and `CONTRACTOR_STANDARDS_EDITION`.
3. Bump `app_settings.contractor_standards.version` in a migration. The edge function and the
   SQL status view read the version from there; the app reads it from TypeScript.
4. Run `npm run standards:verify`, which fails if steps 2 and 3 disagree.

That mirror is the one drift hazard in the design, which is why the verify script exists: if
the two disagree, the roster is either never asked to re-acknowledge or asked forever, and both
failures are silent.

Once merged, everyone on the previous version becomes `outdated`, the admin panel repopulates
with no further code change, and the re-acknowledgment campaign is a worklist rather than a
spreadsheet exercise.

`npm run standards:verify` also checks that the substance survived the edit — that pets still
may not be struck, that phone calls are still returned within five minutes, that falsifying a
checklist is still grounds for removal. Narrowing what was agreed to should fail loudly.

---

## Relationship to the accountability ladder

The addendum names the consequences in the contractor's own acknowledgment: coaching, a formal
strike, suspension, or removal, depending on severity. Those are the existing rungs recorded in
`cleaner_accountability_actions` — see [Cleaners & Contractors](./admin-workspace/cleaners.md).
The addendum does not add a new enforcement mechanism; it makes the existing one land against
something specific that the contractor has, on the record, agreed to.

Three of its rules escalate on their own terms and are written that way in the document:
falsifying checklist completion and any substantiated mistreatment of a client's pet are
grounds for immediate removal, and an allegation of harm to a client's animal is an immediate
suspension pending investigation.
