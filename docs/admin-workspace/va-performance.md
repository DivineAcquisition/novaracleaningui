---
title: VA Performance & EOD
area: VA Performance
category: How the Tool Works
summary: The end-of-day report, what the system verifies independently, and what a flag does and doesn't mean.
whoCanSee: Full admins only (the review screen). Every VA fills in their own EOD.
where: /admin/va-performance
lastVerified: 2026-08-29
order: 14
---

Two halves to this. VAs fill in an end-of-day report at **eod.novaracleaning.com**. Admins
review it here, next to what the system independently observed.

The subtitle sets the tone and is worth taking at face value: *"Verified actuals beside
self-reported EOD. Flags ask for an explanation — you decide the outcome."*

## The end-of-day report

You reach it from a link texted or emailed to you (valid **24 hours**), or by signing in.

### What's on the form, in order

**Hours** — filled in for you from the time tracker. Read-only. *"If it looks wrong, say so in
your notes."*

**Today's numbers** — ten fields: new leads contacted, quotes sent, booked jobs, revenue
booked, jobs completed, commercial outreach, membership closes, reactivations, applicants
screened, cleaners hired.

The instruction on screen is the important part: *"Every field needs an answer. Enter 0 if
there were none — a blank tells us nothing."* Each field also shows what the system counted,
or **not tracked** / **unreachable** where it can't see.

**How the day went** — and the form says plainly: *"None of this is scored."*

- **Primary focus today** — Operations, Sales, Recruiting or Mixed.
- **Blockers** — None, Minor or Major. Minor or Major asks *what's blocked*.
- **Needs management's attention** — No, When you can, or Urgent. Urgent notifies a manager on
  submit.
- **Cleaner issues today** — None, Minor or Serious. Serious notifies on submit.

**Looking ahead** — tomorrow's top priorities (**required**) and optional wins or notes.

Then **Submit EOD**.

:::note The unscored half is not filler
Blockers, management attention and cleaner issues carry no score and never will. They're the
channel for "this is going wrong and I need help" — and the escalation is automatic when you
mark something Urgent or Serious.

Under-using them is the most common mistake. A blocker raised on the day is a problem; a
blocker raised in a monthly review is a month of lost work.
:::

### The submission window

On-time is before **17:30**. You can back-date **1 day**. The day **locks 36 hours** after it
ends, after which you'll see *"This day is locked and can no longer be edited."*

## Two kinds of number

This is the concept the whole screen rests on.

**Verified** numbers are collected independently — from the time tracker, the CRM, the
workspace, Stripe and the recruiting base. **Self-reported** numbers are what the VA typed.

A verified number counts as verified only when the source actually answered. If a source is
unreachable, the value is **unverified** — shown as `unverified`, never as zero.

:::warning Unverified does not mean zero
A cell reading `unverified` means we couldn't see it, not that nothing happened. Treating it
as zero would mark someone down for an integration outage.

The screen is careful about this and so should you be.
:::

## Reviewing

@screenshot va-performance

**Today** shows who submitted, who's outstanding, hours, calls, bookings, revenue booked and
open flags. The status badges are **Submitted**, **Late**, **In progress** and **Not
submitted**.

**Per VA** goes deeper over 7, 30 or 90 days: revenue per VA hour, EOD compliance, open flags,
target attainment, verified totals, self-reported against verified, recent notes, and the
coaching log.

**Revenue per VA hour** is revenue divided by verified hours. It prefers revenue actually
collected over revenue merely booked. **If hours aren't verified, it shows nothing rather than
a number** — no hours means no honest denominator.

**EOD compliance** is submitted days over expected weekdays since the VA's start date, with
late days counted separately.

## Flags

When a self-reported number differs enough from what the system saw, a flag is raised.

| Band | Difference that triggers it |
|---|---|
| Base | more than **20%**, or more than **10** |
| Medium | more than **40%**, or more than **25** |
| High | more than **75%**, or more than **50** |

Whichever is larger applies, so small numbers aren't flagged for trivial percentage gaps.

**Three flags in 14 days** escalates the severity to high automatically.

Two refinements worth knowing. Some metrics are compared as a **ceiling** rather than a match
— commercial outreach only flags if the VA reported *more* than the system saw, never less,
because the system undercounts it. And **nothing is flagged when the corroborating source is
unverified**.

:::warning A flag is a question, not an accusation
The intro on the queue tab says this and means it: flags are prompts, and they carry no pay
consequence.

Most flags have dull explanations — work done in a channel the system can't see, a lead
counted differently, a source that was down. Someone gaming their numbers is the rare case,
not the assumption.
:::

The queue offers three outcomes: **Accept explanation**, **Dismiss — not a real variance**, or
**Confirm issue**. Confirming or dismissing **requires a note** — the placeholder says *"Your
note — required to confirm or dismiss."*

## Reviews and settings

**Weekly / monthly review** generates hours, revenue per hour, target attainment and EOD
compliance for a period, then takes a rating — **Exceeding**, **On track**, **Needs
improvement** or **At risk** — plus notes. Individual metrics are capped at 150% when
averaging attainment, so one enormous month doesn't hide a weak one.

**Settings** holds the timezone, cut-off time, back-date allowance, lock window and the flag
thresholds.

## Common questions

**"I couldn't do anything on a metric today."**
Enter 0. A blank isn't an answer, and the form will refuse it.

**"My hours look wrong."**
They're read-only from the tracker. Say so in your notes — that's what the field is for.

**"I got flagged and I did nothing wrong."**
Very likely true. Explain it; accepting an explanation is the normal outcome.

**"Revenue per hour is blank."**
Hours weren't verified for part of the window. It shows nothing rather than a misleading
number.

**"I missed yesterday's EOD."**
Back-date it — you have one day, and the day locks 36 hours after it ends.
