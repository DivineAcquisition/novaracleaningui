---
title: Getting around & the Dashboard
area: Dashboard
category: How the Tool Works
summary: What the workspace is, how it's laid out, why you may not see every section, and what the dashboard is telling you.
whoCanSee: Admins and VAs
where: /admin/dashboard
lastVerified: 2026-08-29
order: 1
---

The admin workspace is where the office runs the business: taking bookings, staffing them,
paying the people who did them, and dealing with it when something goes wrong. It lives at
**admin.novaracleaning.com** and it is the only place most of that work can be done.

Start here if you're new. It explains the shape of the place, so the other guides make sense.

## Signing in

You sign in with your **@novaracleaning.com** email. A personal address will not work, even
if someone has given your account permission — the workspace checks the email domain
separately from the permission, and it turns away anything that isn't a Novara address.

If you're bounced back to the sign-in screen repeatedly, it's one of three things: you're
signed in with the wrong account, your account doesn't have workspace access yet, or you're
trying to open a section that is admin-only. The third is the most common, and the workspace
will tell you — see below.

## The sidebar

Every section of the workspace is in the left sidebar, with a one-line description of what
it's for.

@screenshot dashboard-sidebar

**You may not see all of them.** There are two levels of access:

- **VA** — the operational set: Dashboard, Bookings, Operations, Cleaners, Internal Booking,
  Proposals, Customers, Recurring, and Quality Control.
- **Full admin** — all of the above plus the money, roles and commercial surfaces: Quotes,
  Pricing, Commercial, Payroll, VA Performance, Weekly Report, and Team.

If a section isn't in your sidebar, you don't have access to it, and typing the address in
directly won't help. You'll get a message reading **"Admins only — this section is restricted
to admins"** and get sent back to the dashboard.

:::note This is not a "you're not trusted" thing
The split is about blast radius, not seniority. The admin-only sections are the ones where a
mistake moves money (Payroll), changes what every future customer is charged (Pricing), or
grants somebody access (Team). Everything you need to run the day is in the VA set.
:::

Each guide in this set says at the top who can see that section, so you can check before
going looking for something.

## What each section is for

| Section | Use it when |
|---|---|
| **Dashboard** | You want a quick read on today. |
| **Bookings** | You need to find, change, cancel, refund or staff a specific job. |
| **Operations** | Something today is at risk, or a job needs a cleaner. |
| **Cleaners** | Anything about a contractor — their status, scores, onboarding, conduct. |
| **Internal Booking** | You're on the phone with a customer and taking the booking yourself. |
| **Proposals** | A business wants a quote for recurring commercial or office work. |
| **Quotes** | You want to find a quote someone saved earlier. |
| **Pricing** | You're changing what the business charges. Rare, and admin-only. |
| **Commercial** | Managing commercial accounts, walkthroughs, insurance, STR turnovers. |
| **Customers** | Account-level things: credits, refunds, billing links, password resets. |
| **Recurring** | Memberships and repeating cleans. |
| **Payroll** | Paying contractors. |
| **Quality Control** | A customer complained, or a job needs documenting or defending. |
| **VA Performance** | Reviewing how the VA team is doing. |
| **Weekly Report** | The weekly sales and growth PDF. |
| **Team** | Adding or removing people's access. |

## The dashboard

The dashboard is a read-only summary of today. There is nothing to click that changes
anything — it's the "how are we doing" screen, not a working screen.

@screenshot dashboard-overview

**Bookings today** counts every booking scheduled for today, with how many are confirmed and
how many are already done underneath.

**Revenue today** adds up today's bookings that are confirmed, assigned or completed. The
smaller number underneath is the month so far. It uses the final charge where a job has one
and the estimate where it doesn't — so it moves slightly as jobs finish and final amounts
land.

**Active cleaners** is contractors who are both approved and currently active. It is not how
many are working today.

**Pending offers** is job offers sent to cleaners that nobody has answered yet. If there's an
amber number under it, there are unresolved dispatch alerts and Operations is where you deal
with them.

**Last 30 days** plots bookings created and revenue collected.

**Live activity** is a running feed of things happening right now — bookings created, offers
sent, offers accepted, jobs completed, texts going out. It updates by itself; you don't need
to refresh.

:::note Revenue today and Payroll will not agree, and that's correct
Revenue today counts what jobs are worth. Payroll counts what contractors are owed. They
measure different things and neither is wrong. If you need the money picture, use the
Payroll and Weekly Report screens rather than reasoning from this tile.
:::

## Things worth knowing before you start

**Almost every screen is a list plus a side panel.** You find the thing in the list, click
it, and a panel slides in from the right with everything you can do to it. Once you've
learned that pattern on Bookings, the rest of the workspace is familiar.

**Buttons get disabled for a reason.** Throughout the workspace, an action you'd expect to be
available will sometimes be greyed out. That's almost never a bug — it's a deliberate stop,
and there's a specific condition behind it. Each guide has a marked box for the stops in that
section. If you're stuck on a greyed-out button, that box is the place to look.

**Actions are logged.** Adjusting a price, granting a credit, overriding a scheduling
conflict, disciplining a contractor — these are recorded with your name against them. That's
protection, not surveillance: when a customer disputes something months later, the record is
what settles it.

## What these guides are, and what they aren't

These guides describe **what the software currently does**. They were written by reading the
code that actually runs, not from a plan or a spec, and each one carries the date it was last
checked.

They do **not** tell you what our policy is. Refund rules, the guarantee, what we promise a
customer — that's the policy and pricing knowledge base, and it is the authority on what we
*should* do. These guides are the authority on which buttons make that happen.

Where we found the two disagreeing, the guide says so in a marked box rather than quietly
picking a side. If you spot one we missed, say so — that's a real finding, not a nitpick.
