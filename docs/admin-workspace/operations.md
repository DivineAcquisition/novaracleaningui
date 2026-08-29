---
title: Operations
area: Operations
category: How the Tool Works
summary: Running today — jobs at risk, finding cover, dispatching work, and why a booking might be missing.
whoCanSee: Admins and VAs
where: /admin/operations
lastVerified: 2026-08-29
order: 5
---

Operations is the "what's going wrong today" screen. It brings together four things that used
to be separate, because working a single late job used to take you across three of them.

@screenshot operations-tabs

| Tab | What it's for |
|---|---|
| **Needs attention** | Jobs at risk right now, and finding cover for them. |
| **Dispatch** | Getting cleaners onto jobs that don't have them. |
| **Map** | Where cleaners and bookings are, and where we're thin. |
| **Sync health** | Why a booking might not have appeared where you expected. |

The tab is in the address, so you can bookmark or share a link straight to the one you want.

## Needs attention

This is the first place to look each morning and the place to sit during the day.

It refreshes itself every 60 seconds. **Check now** runs the sweep immediately — it re-reads
every job in flight and re-decides what's at risk, then tells you what it found.

The counters across the top are: **At risk now**, **Customer not told yet**, **No-shows**,
**Looking for cover**, **Uncovered**, and **Days with no backup**.

:::warning "Customer not told yet" is the one that costs us
A late job the customer knows about is an inconvenience. A late job they find out about by
standing in an empty house is a refund, a bad review, and often a lost customer.

If that number isn't zero, work it before anything else on this screen.
:::

### Sub-tabs

- **At risk** — the live list, grouped so the worst is first: no-shows, then customers who
  haven't been told, then told-but-still-at-risk.
- **Coverage** — jobs that need a cleaner found.
- **On call** — who's designated as backup for a given day.
- **Projections** — how long jobs actually take versus what we assumed.
- **Thresholds** — the settings behind all of it.

### Working a job that's at risk

Each at-risk job is a card with the actions in the order you'd use them:

**Send to {name}** sends the customer the heads-up. The message is drafted for you. This is
usually the first thing to do — tell the customer before you've solved it, not after.

**I'm on it** marks that you've picked the job up, so nobody duplicates your work.

**Nudge again** chases the cleaner. **They gave me an ETA** logs how late they'll be — 10, 20,
30, 45, 60 or 90 minutes. **They cancelled** records that they're not coming, which starts the
coverage process.

**Find coverage** ranks who could take it. If nobody can, you'll see:

> Coverage search opened, but nobody clears this job's window and zone right now. Check the
> Coverage tab.

**Not needed** dismisses the drafted message, and **requires a reason** — you'll get *"Say why
the customer doesn't need this."* if you leave it blank.

The badges on each card use plain language: **Late start**, **Running over**, **Bigger than
scoped**, **No-show**, **Cancelled by cleaner**.

### Coverage

When a job has no one coming, Coverage is where you fix it.

**Offer next N** sends the job to the next batch of untried cleaners. The button disables
itself when there's nobody left to ask and changes to **Everybody asked** — which is the
signal to stop refreshing and start making decisions.

**Assign now, skip the offer** puts someone on it directly. It asks for a reason and the
urgency.

**Nobody can cover this** marks it uncovered. Only do this when it's true — it's the trigger
for the customer conversation, and an uncovered job that's still marked "sourcing" is a
customer nobody is calling.

Once uncovered, **Credit the customer** applies goodwill. It needs an amount above zero.

**Bench depth by day** shows how many jobs, how many STR turnovers, how many people on call
and how much cover exists for each upcoming day. It's the early warning — a day with jobs and
no bench is next week's emergency.

### On call

Designate backup cover for a day: pick the day, pick the cleaner, set an order (lower goes
first), add a note. Being on call is normal assignment at normal pay if they're activated.

If the cleaner dropdown is empty you'll see:

> Nobody has told us they work that day. That is a hiring signal, not a scheduling one.

Which is exactly right — you can't schedule your way out of not having enough people.

### Projections and Thresholds

**Projections** compares how long jobs took against what we projected, per service and home
size. Rows that are consistently wrong get a **chronic** badge and a suggested correction you
can apply. This matters more than it looks: the projected hours feed the price floor, so a
service we consistently underestimate is a service we're consistently underpricing.

**Thresholds** holds the settings — buffer rules, when to conclude a cleaner isn't coming,
overrun tolerances, whether coverage starts automatically on a no-show, whether the first
customer heads-up sends without a tap. Both admins and VAs can save these. Change them
deliberately.

## Dispatch

Dispatch is about getting cleaners onto jobs. It polls every 45 seconds.

The tiles across the top are **Awaiting approval**, **Needs dispatch**, **Offers out**,
**Crews working**, and **Add-ons to review**.

**Needs dispatch** lists confirmed bookings that don't have a job yet. Two buttons per
booking:

- **Approve & send offers** — creates the job and texts offers out.
- **Queue** — creates the job without sending offers.

Below that, the pipeline runs left to right: **Awaiting your approval**, **Needs attention**,
**New**, **Dispatching**, **Offers out**, **Confirmed**, **In progress**, **Completed**. Each
job card shows how many of the needed cleaners are confirmed, the contractor checklist
progress, and a contextual button — **Approve & send offers**, **Re-dispatch**, or **Send more
offers**.

Two switches sit at the top:

- **Auto-offers** — when off, jobs wait for you to approve them before offers go out. Off is
  the deliberate, approval-first posture.
- **Contractor add-ons** — whether contractors can request add-ons from the field.

### Add-on approvals

When a contractor finds extra work on site, it lands here. Set the charge amount and
**Approve & charge** — which charges the customer's card on file — or **Reject**. The approve
button is disabled until the price is valid.

:::warning Approve means charge, immediately
This isn't a note-to-self. Approving charges the customer's saved card for the amount in the
box. If you're unsure whether the customer agreed to the extra work, find that out first —
an unexpected charge is a chargeback waiting to happen.
:::

## Map

Read-only. It plots active cleaners and the next 14 days of bookings, plus live GPS for
anyone clocked in via Apploye.

The legend covers active cleaner and confirmed booking, pending, completed, live GPS, and
inactive.

The two panels that earn their keep are **Top booking ZIPs (next 14d)** — where demand
actually is — and **Coverage gaps**, which lists ZIPs that have bookings and zero active
cleaners, each tagged **Recruit here**. That second list is the recruiting brief.

If the map itself doesn't load you'll see **"Google Maps unavailable"** with setup
instructions; that's a configuration issue, not something you can fix from here.

## Sync health

This is the answer to "the booking is in the workspace but it hasn't shown up in Airtable" and
similar. It refreshes every 30 seconds.

The four cards are **Flows** (all healthy, or how many are failing), **Pending changes**,
**Needs review**, and whether the inbound connection is on a live webhook or polling every
five minutes.

The global buttons: **Run full re-sync**, **Pull remote changes now**, **Reconnect webhook**,
and **Revive N dead item(s)** when things have given up retrying.

**Needs review** lists items the sync couldn't resolve by itself, tagged with why: unmapped
field, conflict, identity, unknown option, deleted in Airtable, or sync gave up. Each has a
**Resolve** button. When it's clear you'll see *"Nothing flagged — no conflicts, unmapped
fields, or identity issues outstanding."*

:::note Check here before re-creating anything
If a record is missing downstream, the overwhelmingly likely cause is a sync that hasn't
drained yet or an item that needs reviving — not a booking that was never made. Re-creating
it by hand produces a duplicate that someone has to unpick later. Look here first.
:::

## Common questions

**"A cleaner isn't answering and the job starts in an hour."**
Needs attention → the job's card → **Nudge again**, then **Send to {name}** to tell the
customer, then **Find coverage**. In that order — the customer heads-up shouldn't wait on the
outcome.

**"Offers are going out that I didn't send."**
Auto-offers is switched on. It's a toggle on the Dispatch tab.

**"Everybody asked and nobody accepted."**
Use **Assign now, skip the offer** if there's a reasonable person to assign, or mark it
**Nobody can cover this** and start the customer conversation with a credit.

**"Why is a job flagged at risk when it's on time?"**
Usually a delay cascade — an earlier job in that crew's day is running over, so this one is
projected to start late. The card will say so.
