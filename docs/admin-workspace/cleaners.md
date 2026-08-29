---
title: Cleaners & Contractors
area: Cleaners
category: How the Tool Works
summary: The contractor directory, what the scores mean, onboarding, pay tiers, and how conduct is handled.
whoCanSee: Admins and VAs (some actions are admin-only)
where: /admin/cleaners
lastVerified: 2026-08-29
order: 6
---

Everything about a contractor lives here: their status, their onboarding, their scores, their
jobs, and their conduct record.

The screen has three sections, switched at the top: **Contractors**, **Applicants** and
**Crews**.

## The directory

@screenshot cleaners-directory

Search matches name, email, phone or ZIP. The status filters are **All**, **Active**,
**Pending**, **Suspended**, **Inactive** and **Terminated**.

Two panels appear above the list when they have anything in them, and hide when they don't:
contractors working without a signed agreement, and the accountability watchlist. If they're
showing, they need attention.

@screenshot cleaners-row

Each row shows the contractor's name with their tier and revenue share, their contact details
and ZIP, their status, an onboarding progress bar, and their scores.

## What the scores mean

There are three, and people mix them up constantly.

| Score | What it measures |
|---|---|
| **Novara Score** | **Reliability.** Do they accept work, carry a workload, and get jobs done. |
| **Rating** | **Quality.** Customer ratings and quality-control cases per job. |
| **Overall** | The two above, combined. |

The colours are the same everywhere: **70 and above** is good, **45 to 69** is watch,
**below 45** is a problem.

**Novara Score** is built from three parts, weighted: acceptance rate (40), workload (30) and
jobs completed (30). Completed jobs count toward a full mark at **50 jobs** — so a new
contractor starts low on that component and it isn't a criticism.

**Rating** starts from the customer average out of five, scaled to 100. A contractor with no
ratings yet starts at **75** rather than zero. Quality-control cases in the last 90 days pull
it down, weighted by severity — critical counts 3, high 2, medium 1, low 0.5 — and each
active strike counts the same as a high-severity case. The penalty is capped at 60 points.

:::note Tips never affect any score
This is deliberate and worth repeating to contractors who ask. Tips are influenced by things
outside a cleaner's control — a customer's mood, whether they were home, the neighbourhood.
Scoring on them would punish people for their postcode.
:::

Scores recompute every six hours and on demand. An admin can pin a score with an override and
a reason, and clear it later.

## The contractor panel

Click a row and the panel opens with five tabs: **Jobs**, **Onboarding**, **Performance**,
**Accountability** and **GHL**.

### Jobs

Pending offers with **Accept for them** and **Decline**, then assigned jobs with **Start job
/ check in**, **Drop from job**, and the before/after/combined photo links.

### Onboarding

Three items: **Phone verified**, **Contractor agreement signed**, **Stripe payouts
connected**. Underneath, whether their portal is ready.

Action cards appear for whatever is missing — **Send setup link**, **Send agreement link**,
**Send supply checklist**. These are disabled if the contractor has neither an email nor a
phone number.

### Performance

The three score tiles, each clickable to override. The override dialog needs a new value from
0 to 100 and a **required reason**.

Below that: average rating, on-time rate, acceptance, completed jobs, total bookings, jobs in
the last 7 days, workload, and constraints.

The **Score engine** button (from the directory header) opens the weights. The Novara
composite weights must add up to 100, and so must the reliability/quality split. **Save &
recompute** applies them to everyone.

### Accountability

Conduct, handled as a ladder rather than ad-hoc:

1. **Coaching note** — documented, email optional.
2. **Formal warning / strike** — numbered, hits the Novara Score, formal email.
3. **Suspension** — blocks new offers. Existing jobs are kept or reassigned.
4. **Removal** — portal access off, history retained.

:::gate You can't skip steps without saying why
A suspension normally requires **2 active strikes**; a removal normally requires **3**. To go
straight there you must tick the severe-cause box and write a documented reason. Otherwise:

> This skips the normal ladder — confirm severe cause with a documented reason.

Every action also requires an admin note and either a linked quality-control case or a written
reason:

> Link a QC case or write a documented reason — no undocumented actions.

The reason for the friction is simple: these decisions affect someone's income, and they get
challenged. A documented ladder is defensible; a suspension with no note is not.
:::

Strikes expire after **6 months** by default. Admins can change that to anything from 0 to 60
months, where 0 means never.

The watchlist flags **repeat offenders** — 2 or more strikes within 180 days, including
expired ones — and **repeat quality-miss re-cleans** — 2 or more in 90 days. The second is a
coaching signal only and carries no automatic penalty.

The **Attendance · last 90 days** badges show no-shows, short-notice cancels, good-notice
cancels, late-but-reachable, unanswered nudges, and on-call days.

:::note Accountability never touches pay for work already done
Suspending or removing a contractor does not claw back pay for completed jobs. That's a firm
line — the work was done and it gets paid.
:::

## Pay tiers

The panel shows the contractor's tier and revenue share, with a button to promote them —
**Increase to N%** — which is disabled at the top tier or if they're terminated.

:::drift The tier ladder on this screen shows out-of-date percentages
The Cleaners screen shows the ladder as **Foundation 35% → Proven 40% → Elite 45%**. Those
numbers are written into the screen itself.

The live pay-rate table that actually calculates a payout says something different:

| Tier | Working solo | On a crew of 2 or more |
|---|---|---|
| Foundation | **37%** | 40% |
| Proven | **41%** | 45% |
| Elite | **47%** | 50% |

So the screen understates solo rates by two points at every tier. **Contractors are paid the
live table, not the label** — but if you have quoted 35/40/45 to someone, you have quoted
them low, and the Pay Rates tab in [Payroll](/docs/payroll) is the authority.

An admin should reconcile the ladder shown on this screen with the live table.
:::

Note also that the percentage is the **whole crew's pool**, then divided between them — see
[Payroll](/docs/payroll) for how that works.

## Status and lifecycle

The **Directory status** picker offers Pending, Active, Inactive and Terminated. If someone
is suspended through accountability, the picker shows that as disabled — you lift a suspension
from the Accountability tab, not by changing the status here.

Checkboxes cover availability for bookings, walkthrough eligibility, approval, and (admins
only) skipping compliance.

The lifecycle buttons are **Pause / deactivate**, **Terminate**, **Reactivate**, **Flag for
review**, **Invite to Apploye**, and — admins only — **Delete from directory**.

:::gate Reactivating needs current compliance documents
Reactivation is refused if the background check is missing or expired, or insurance is
missing or expired. The same checks apply when setting someone to Active, unless an admin
uses the skip-compliance override.

This isn't paperwork for its own sake. Sending an uninsured contractor into a customer's home
is the kind of thing that ends businesses.
:::

**Terminate** opens its own dialog: a reason for leaving, an internal rehire label
(Rehireable, No-hire, Under review, Blacklist), an effective date, and whether to email the
termination letter.

## Adding a contractor

**+ Add cleaner** offers two modes:

- **Full account** — first name, last name, email, phone, home ZIP, pay tier and service ZIPs.
- **Bypass onboarding** — send a 6-digit code by SMS and verify it to activate immediately.

## Applicants

The Applicants section is the hiring pipeline, filtered by stage: All, Applicants, Screening,
Hold, Onboarding, Agreement signed, Active, Rejected, Needs attention.

Stage badges include **Stalled** (more than three days in onboarding without signing) and
**Follow-up due**.

The actions run the pipeline: start or resume phone screening, advance to screening, launch
onboarding, re-send onboarding, send the agreement link, and finally activate.

:::gate Activate is blocked until the agreement and payouts are done
The **Activate contractor** button stays disabled with one of two tooltips:

- *Blocked until the agreement is signed*
- *Blocked until payout setup is complete*

Both are genuine prerequisites. Without a signed agreement we have no contractual
relationship; without Stripe Connect there is no way to pay them, so activating just creates
an angry contractor a fortnight later.
:::

**Phone screening** has its own stops: an applicant under 18 can only be declined, failed
hard qualifiers route to decline or hold, and answering "no" to the acknowledgment or the
non-solicitation question blocks advancing.

## Crews

Crews group contractors for multi-cleaner jobs. Create one with a name, add cleaners from the
unassigned list, set a lead with **Make lead**, and remove people as needed. Deleting a crew
unassigns its members rather than affecting them otherwise.

## Common questions

**"Their Novara Score dropped and they haven't done anything wrong."**
Check acceptance. Declining or letting offers expire moves that score more than anything else.

**"A new contractor's score looks bad."**
Completed jobs count toward a full mark at 50 jobs, and quality starts at 75 with no ratings.
A new person will sit low for a while. That's the scale, not a judgement.

**"I can't set someone to Active."**
Compliance — background check or insurance, missing or expired. An admin can override, but
find out why the document is missing first.

**"Can I suspend someone for a single bad job?"**
Only with the severe-cause box ticked and a documented reason. For one bad job, a coaching
note or a strike is the proportionate step.

**"What percentage does this contractor actually get paid?"**
The live table in Payroll → Pay Rates, not the ladder shown on this screen. See the drift note
above.
