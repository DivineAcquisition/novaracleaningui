---
title: Recurring & Memberships
area: Recurring
category: How the Tool Works
summary: Glow memberships and repeating cleans — rates, credits, pausing, and the difference between cancel and delete.
whoCanSee: Admins and VAs
where: /admin/recurring
lastVerified: 2026-08-29
order: 9
---

This is the hub for every customer on a repeating plan. The engine books each cycle by itself,
assigns the previous or preferred cleaner, and texts the customer a self-service link — so
most of the time this screen is for watching rather than doing.

@screenshot recurring-hub

## The portfolio numbers

**Active MRR** is projected monthly recurring revenue from active members, with the average
per member underneath. **Active ARR** is that times twelve. **Portfolio LTV** is what
membership cleans have been worth to date. **Active members** is the count.

**At risk** is the one to act on. A member is at risk when they have no active schedule, are
overdue for a clean, or have unused credits about to expire at the end of their period.

A banner appears when active members have no schedule at all: *"N active member(s) without a
recurring schedule — their cleans won't auto-book until a schedule is set up."*

:::warning A member with no schedule is being billed for nothing
They are paying monthly and no cleans are being booked. They will notice, and when they do
it's a refund conversation and usually a cancellation. Clear that banner promptly.
:::

## Two tabs

**Members** is the billing view — who's on a plan, what they pay, what their credits look
like. **Recurring schedules** is the operational view — when the next clean is, who's doing
it, at what price.

A customer can appear in one and not the other, and that mismatch is what the at-risk count
is telling you about.

## Membership rates

Published monthly rates. The zone still applies on top — Zone A adds 15%, Zone C takes 10%
off. Demand never applies to a member.

| Home size | Glow Monthly | Glow Bi-Weekly | Glow Weekly |
|---|---|---|---|
| 0 – 999 sq ft | $129 | $199 | $359 |
| 1,000 – 1,500 sq ft | $159 | $249 | $449 |
| 1,501 – 2,000 sq ft | $199 | $319 | $569 |
| 2,001 – 2,500 sq ft | $239 | $369 | $659 |
| 2,501 – 3,000 sq ft | $279 | $449 | $799 |
| 3,001 – 3,500 sq ft | $319 | $499 | **not offered** |
| 3,501 – 4,000 sq ft | $369 | $579 | **not offered** |
| 4,001 – 4,500 sq ft | $409 | $649 | **not offered** |
| 4,501 – 5,000 sq ft | $459 | $719 | **not offered** |

Credits included per month: **Monthly 1, Bi-Weekly 2, Weekly 4.** They reset when the Stripe
period renews.

New members also pay a one-time **$75** first-clean deep clean, unless the home has had a
professional deep clean in the last three months.

**Worked example.** Glow Bi-Weekly on a 1,700 sq ft home in Zone A: the published rate is
$319.00, Zone A adds 15% (+$47.85), so it's **$366.85 a month**. Add the one-time $75.00
first-clean deep and the first month is **$441.85**, then $366.85 a month thereafter.

:::drift Weekly pricing disagrees between the live configuration and older code
Two differences, both real:

- **0–999 sq ft weekly** — the live configuration says **$359**; an older price list in the
  application code says $349.
- **Weekly at 3,001 sq ft and above** — the live configuration says **not offered**; the
  older list still carries prices.

The rates published in this guide are the live configuration, which is what quotes use. If
you try to sell a weekly plan on a home over 3,000 sq ft, the booking screen will refuse with
*"This plan frequency is not offered for this home size — quote a custom plan."* That is not
a bug.
:::

## Working a member

Click a member to open their panel. The badges tell you whether they're an active member,
active recurring without Stripe, or inactive — and whether there's a Stripe subscription
behind them, which decides what billing controls you get.

The panel holds their plan, monthly rate, per-clean price, credits remaining, renewal date,
next clean and last clean; the last cleaner; the latest quality-control case; revenue and
lifetime value; their schedule; and the communications and billing controls.

**Send checklist** and **Send agreement** are there for when a customer says they never
received either.

### Billing controls

These only appear for members with a Stripe subscription. Without one you'll get *"No Stripe
subscription on this client — billing controls don't apply."*

- **Update price** changes the monthly rate, with proration. Minimum $1.
- **Pause billing** stops collection without cancelling. **Resume billing** restarts it.

### Cancel versus delete

:::warning These are not two words for the same thing
**Cancel membership** stops the recurring cleans, deactivates the schedules, cancels the
Stripe subscription **at the end of the current period**, and **emails and texts the
customer**. That's the normal path — they've paid for the period, so they keep it.

**Delete membership** removes the plan, cancels Stripe **immediately**, deletes the schedule
and credits, and **tells the customer nothing at all**. It cannot be undone.

Delete is for cleaning up a plan that was created in error. If a real customer is leaving,
cancel — deleting means they lose the period they paid for and hear nothing about it.
:::

## Schedules

The schedules tab groups plans into **Active** and **Paused**, each summarised as: cadence,
next date, time, cleaner, price per clean, and whether it's covered by membership credit.

Expanding a row lets you edit cadence, preferred cleaner, time window, next service date,
price per clean, address and office notes. Changes save as you go.

The icon buttons on each row are: text the customer their self-service manage link, copy that
link, send the cleaning checklist, send the membership agreement, generate the next clean
now, pause or resume, and edit.

Two more in the expanded panel:

- **Skip next visit** — pushes the next date forward one cycle. Disabled if there's no next
  date set.
- **End plan** — stops the plan and clears the next date.

The hint on screen sums it up: *"Pause = temporary hold (resume anytime) · End = stops the
plan and clears the next date."*

:::note Copy link needs the link to exist first
If nobody has ever texted the customer their manage link, there's no token yet and you'll get
*"No link minted yet — use 'Text link' once (it mints the token)."* Text it once, then you can
copy it.
:::

## Starting a plan

**New recurring plan** takes you to [Internal Booking](/docs/internal-booking) with the
recurring path preselected. For an existing member without a schedule, **Set up schedule** in
their panel does the same with their details filled in.

## Common questions

**"The next clean didn't get booked."**
Check the plan is Active and has a next service date. If both are fine, use **Generate the
next clean now** and see what it reports.

**"A member wants to skip a month."**
Skip the next visit for one clean; pause the schedule for a longer break. Pausing the
schedule does not pause their billing — if they shouldn't be charged either, pause billing
too.

**"They're being charged but not getting cleans."**
That's the at-risk banner. They have a subscription and no active schedule. Set one up and
consider a credit for the gap.

**"Can I change what a member pays?"**
Yes, with **Update price** — it updates Stripe with proration. Their per-clean price on the
schedule is separate and edited on the schedules tab.

**"Why won't it let me sell a weekly plan?"**
Weekly isn't offered at 3,001 sq ft and above. Quote a custom plan.
