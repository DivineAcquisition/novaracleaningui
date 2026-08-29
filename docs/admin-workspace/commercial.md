---
title: Commercial & STR
area: Commercial
category: How the Tool Works
summary: Commercial accounts, insurance certificates and the block they cause, and short-term-rental turnovers.
whoCanSee: Full admins only
where: /admin/commercial
lastVerified: 2026-08-29
order: 12
---

Commercial is admin-only. VAs are sent back to the dashboard with **"Admins only."**

That's worth knowing before you go looking: VAs *can* use [Proposals](/docs/proposals) for
walkthroughs, pricing and sending. What lives only here is account management, insurance
compliance, commercial job booking and the STR side.

@screenshot commercial-hub

Five workspaces:

| Workspace | What it holds |
|---|---|
| **Home** | Pipeline snapshot and the account list. |
| **Deals** | Walkthrough findings and firm price. |
| **Jobs** | One-off commercial jobs, recurring schedules, published checklists. |
| **Compliance** | Client insurance certificates and our own. |
| **STR** | Turnovers, hosts and short-term-rental pricing. |

Sending proposals and the deal pipeline redirect to [Proposals](/docs/proposals) — they used
to live here, and old links still work.

## Accounts

Accounts run through **prospect → onboarding → active → paused → offboarded**.

:::gate An account can't be set Active until three things are true
> Can't set Active — signed agreement + payment method + at least one site are required
> first.

All three, no override. An "active" account with no signed agreement is work we can't invoice
for.
:::

## Insurance certificates

This is the part of Commercial with the widest blast radius, and it's worth understanding
even if you never touch this screen.

Client certificate statuses are **Current**, **Expiring soon**, **Expired** and **Not on
file**. The warning window is **30 days**.

:::gate An expired or missing certificate blocks every site on the account
Not the site — **the account**. When a client's certificate is expired or missing, it blocks
new bookings, recurring generation, and dispatch for every site they have.

So a lapsed certificate on a multi-site client silently stops all of their work. If a
commercial client's recurring cleans have quietly stopped generating, look here first.
:::

The tiles are **Blocked accounts**, **Expiring soon**, **On override** and **Current**.

**Record a certificate** uploads the PDF with its dates, carrier and policy number. Recording
a valid one lifts the block immediately: *"Certificate recorded — the block is lifted for all
of this account's sites."*

If you upload without an expiration date, the certificate is parked for review and **the block
stays in place** — the screen tells you so.

**Request a renewal** composes and sends the chase.

**Override the block** is the rare escape hatch: a documented reason of at least 10 characters
and a window of 1 to 30 days. It does not change the certificate status — it suspends the
block temporarily so work can continue while the paperwork catches up. **Revoke override
now** ends it early.

An automated monitor warns at **90, 30, 15 and 7 days** before expiry, then daily. It only
alerts; it never changes a status.

### Our own certificate

The **Our certificate of insurance** panel holds Novara's own. It shows **Not on file**,
**Expired** or **Current through {date}**, and lets you upload or replace it and resend it to
clients holding an older copy.

Remember the fourth dispatch requirement from [Proposals](/docs/proposals): *our* certificate
must have been sent to the client. A deal can be fully priced, signed and billed and still not
dispatch because of that.

## Jobs, recurring and checklists

**Book job** creates a one-off commercial job. **Recurring** manages repeating commercial and
partner schedules. **Checklists** publishes what the crew is asked to do on site, with
standard, review and health views.

## STR

The STR workspace covers short-term-rental hosts, their properties and turnovers. Two sync
buttons sit in the header on the STR and Accounts tabs: **Sync contractors** and **Sync to
Airtable**.

Hosts have their own portal at partner.novaracleaning.com; this is the internal side of it.

## Common questions

**"A commercial client's cleans stopped generating."**
Check Compliance first. An expired certificate blocks the whole account.

**"Can I override an insurance block?"**
Yes, with a documented reason, for 1 to 30 days. Use it to cover a renewal in flight, not to
avoid the conversation.

**"The deal is signed and billed but won't dispatch."**
Almost certainly our certificate hasn't been sent to the client — the fourth requirement.

**"I'm a VA and I can't open this."**
Correct. Use Proposals for walkthroughs, pricing and sending; ask an admin for account,
compliance and STR work.
