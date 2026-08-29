---
title: Payroll
area: Payroll
category: How the Tool Works
summary: How contractor pay is calculated, what each of the four tabs actually does, and which one moves money.
whoCanSee: Full admins only
where: /admin/payroll
lastVerified: 2026-08-29
order: 7
---

Payroll is admin-only. VAs who open it get **"Admins only — this section is restricted to
admins"** and are sent back to the dashboard.

It has four tabs and they do genuinely different things. Confusing them is the main way
people get payroll wrong, so start here:

@screenshot payroll-tabs

| Tab | What it does | Does it move money? |
|---|---|---|
| **Custom Payout** | Records what a contractor is owed for a job and notifies them. | **No** |
| **Extra Pay** | Records mileage, supplies, bonuses, overtime. | **No** |
| **Pay Rates** | Sets the crew-size percentages. | No |
| **Run Payroll** | Sends transfers through Stripe. | **Yes** |

:::warning Confirming a payout is not paying it
**Custom Payout** confirms an amount and tells the contractor about it. **Stripe transfers
for Custom Payout are currently paused**, so when you've actually paid someone by another
route, come back and use **Mark paid**.

**Run Payroll** sends real money — but only for **Extra Pay**. It does not pay Custom Payout
lines. If you assume Run Payroll settles everything, contractors will be told they're owed
money that never arrives.
:::

## How pay is calculated

A contractor's pay is a percentage of the job's value. Two things set the percentage: their
tier, and whether they're working alone or on a crew.

| Tier | Working solo | On a crew of 2 or more |
|---|---|---|
| Foundation | **37%** | **40%** |
| Proven | **41%** | **45%** |
| Elite | **47%** | **50%** |

**The percentage is the whole crew's pool, and then it's divided between them.** This is the
part people get wrong.

> Per-cleaner share = job value × their rate ÷ crew size

**Worked example.** Two Proven contractors on a $205 job. The crew-of-2 rate for Proven is
45%, so the pool is $92.25, and each of them gets **$46.12**.

Not $92.25 each. The percentage never applies twice.

On a mixed-tier crew, each person's share is worked out from **their own tier's rate** for
that crew size, divided by the crew size. A Foundation and an Elite contractor on the same
two-person job take home different amounts.

:::drift The Cleaners screen shows different tier percentages
The contractor directory displays the tier ladder as Foundation 35% / Proven 40% / Elite 45%.
Those are hard-coded into that screen and they are **two points low for solo work** at every
tier.

The table above is the live rate table — the one that actually calculates pay, and the one
the **Pay Rates** tab edits. If you've quoted a contractor 35%, you've quoted them under what
they'll receive.

Worth reconciling; until then, quote from Pay Rates.
:::

## Pay Rates

The **Crew-size pay rates** matrix: tiers down the side, crew-size brackets across the top,
an editable percentage in each cell that saves when you click away. You can add a bracket
with a minimum crew size, an optional maximum (blank means "and up"), a tier and a rate.

Change these carefully — they apply to every future payout calculation, and the Foundation
solo rate also feeds the price floor that protects the whole model.

## Custom Payout

The dashboard at the top shows **Paid out**, **Revenue**, **Profit** and **Pending payouts**
for this week, month or year.

To confirm a payout:

1. Search for the job by number, customer or cleaner.
2. Check the revenue shown. **Adjust** changes it if the job's value was wrong.
3. Tick who was on the job and set each person's amount. A suggested split is filled in for
   you.
4. Watch the live **Our profit** and **% paid out** figures as you type.
5. Add a note if there's a bonus or a deduction to explain.
6. **Confirm & notify N contractor(s)**.

That records the payout and emails and texts the contractor. It does not transfer anything.

:::note The suggested split here is simpler than the real formula
The suggestion divides the contractor's flat percentage by the crew size. It does not use the
full tier-and-crew-bracket table above, and it falls back to 35% if a contractor has no
percentage set.

It is a starting point, not an answer. **You are confirming the amount**, so check it against
the rate table — particularly on mixed-tier crews, where the suggestion will be wrong for at
least one person.
:::

The **Recent payouts** table lists cleaner, date, revenue, payout, profit, percentage paid
out, and status. Pending rows have a **Mark paid** button for when you've settled outside
Stripe.

## Extra Pay

Everything that isn't the job percentage:

| Field | Notes |
|---|---|
| **Supply reimbursement** | A dollar amount. |
| **Mileage** | Miles × rate. The rate defaults to **$0.70 per mile**. |
| **Surge pay** | Difficult or last-minute job bump. |
| **Overtime** | Hours × hourly rate. |
| **Job value increase** | The job was bigger than booked. |

**Record & notify {cleaner}** saves it and tells them.

:::gate There is a $5,000 cap per payment
Anything above it is refused with *"Total exceeds the $5,000.00 per-payment cap."* If a
contractor genuinely needs more than $5,000 in one go, split it or get it checked — a figure
that large is usually a typo.
:::

The history table shows every extra payment with its status. Pending or failed rows have a
**Pay via Stripe** button.

## Run Payroll

This is the tab that moves money.

It shows the available Stripe balance, then a card per contractor with **Connect ready** or
**No Stripe Connect**, and a **Pay {amount}** button.

**Pay all owed** does everyone at once, and is disabled if the balance won't cover it.

:::gate Three things disable a payment
- **The contractor hasn't finished Stripe Connect onboarding** — *"Contractor must finish
  Stripe Connect onboarding before we can transfer."* Nothing you do in the workspace fixes
  this; they have to complete it. **Refresh Connect** re-checks their status.
- **Not enough platform balance** — *"Not enough platform Stripe balance for this cleaner
  yet."* Wait for funds to settle.
- **Nothing owed.**
:::

:::warning Run Payroll pays Extra Pay only
It settles pending and failed **Extra Pay** lines. Custom Payout amounts are excluded,
because Stripe transfers for those are paused.

The empty state says so directly: *"Nothing pending Extra Pay. Custom Payout is confirm +
notify, then Mark paid — Stripe for those is paused."*

So a contractor can be owed money that Run Payroll will never send. Custom Payout is settled
outside the system and then marked paid.
:::

Confirmation emails copy in contact@ and dispatch@.

## Common questions

**"I confirmed the payout — when do they get the money?"**
They don't, from that action. Custom Payout records and notifies. Pay by your usual route,
then **Mark paid**.

**"Two cleaners did a $205 job at Proven. Is that $92.25 each?"**
No — $92.25 is the pool. They get $46.12 each.

**"Run Payroll says nothing is pending but I confirmed payouts today."**
Run Payroll only handles Extra Pay. Confirmed Custom Payouts won't appear.

**"The Pay button is greyed out."**
Either they haven't finished Stripe Connect, or the platform balance is too low.

**"Which percentage is right — 35% or 37%?"**
37% for Foundation solo. The Pay Rates tab is the authority; the Cleaners screen label is
stale.
