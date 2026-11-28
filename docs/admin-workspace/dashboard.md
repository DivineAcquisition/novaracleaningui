---
title: Getting around & Today
area: Dashboard
category: How the Tool Works
summary: What the workspace is, how the sidebar is grouped, why you may not see every section, and what Today is telling you.
whoCanSee: Admins and VAs
where: /admin/dashboard
lastVerified: 2026-11-27
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

The left sidebar starts with a **+ New Booking** button (the call workspace), then five
groups. Click a group heading to collapse it; the workspace remembers that, and opens a group
again automatically when you go to a page inside it. On a phone the same menu opens from the
☰ button and closes as soon as you pick a page.

@screenshot dashboard-sidebar

| Group | Pages, in order |
|---|---|
| **Daily Work** | Today · Bookings · Dispatch & Coverage · Quality Control |
| **Sales & Clients** | Quotes · Proposals · Customers · Business Accounts · Recurring Plans |
| **Workforce** | Cleaners & Crews · Hiring & Onboarding |
| **Finance & Reports** | Cleaner Pay · Profit & Loss · VA Performance · Weekly Report |
| **Settings** | Pricing Rules · Team Access · Email Settings & Delivery · Booking Compliance · Assistant Settings |

**Ask Novara** (the assistant) is the button in the top bar, and **Search** (⌘K / Ctrl+K)
finds any page, booking or cleaner. Search also understands the old names, so typing
"Internal Booking", "CSR", "Operations", "Accounts", "Payroll" or "Intake" still takes you to
the right place.

**You may not see all of them.** There are two levels of access:

- **VA** — Daily Work, plus Proposals, Customers and Recurring Plans, plus Cleaners & Crews
  and Hiring & Onboarding (which for a VA opens the applicant pipeline inside Cleaners).
  Groups with nothing you can open are hidden.
- **Full admin** — everything, including Quotes, Business Accounts, the whole Finance &
  reports group and Settings.

If a page isn't in your sidebar, you don't have access to it, and typing the address in
directly won't help. You'll get a message reading **"Admins only — this section is restricted
to admins"** and get sent back to Today.

:::note This is not a "you're not trusted" thing
The split is about blast radius, not seniority. The admin-only sections are the ones where a
mistake moves money (Cleaner Pay), changes what every future customer is charged (Pricing
rules), or grants somebody access (Team Access). Everything you need to run the day is in the
VA set.
:::

Each guide in this set says at the top who can see that section, so you can check before
going looking for something.

## What each section is for

| Section (former name) | Use it when |
|---|---|
| **+ New Booking** (Internal Booking, CSR) | You're on the phone with a customer: quote, save, resume or book. |
| **Today** (Dashboard) | You want to know what needs a decision now. |
| **Bookings** | You need to find, change, cancel, refund or staff a specific job. |
| **Dispatch & Coverage** (Operations) | Something today is at risk, or a job needs a cleaner. |
| **Quality Control** | A customer complained, or a job needs documenting or defending. |
| **Quotes** | You want to find a quote someone saved earlier. |
| **Proposals** | A business wants a quote for recurring commercial or office work. |
| **Customers** | Account-level things: credits, refunds, billing links, password resets. |
| **Business Accounts** (Accounts, Commercial) | Commercial accounts, STR hosts, property managers, insurance. |
| **Recurring Plans** (Recurring) | Memberships and repeating cleans. |
| **Cleaners & Crews** (Cleaners) | Anything about a contractor — status, scores, crews, conduct. |
| **Hiring & Onboarding** (Intake, Applicants) | Applicants and onboarding. |
| **Cleaner Pay** (Payroll) | Paying contractors. |
| **Profit & Loss** (P&L) | Collected vs pipeline, ad spend, contribution, ROAS. |
| **VA Performance** | Reviewing how the VA team is doing. |
| **Weekly Report** | The weekly sales and growth report. |
| **Pricing Rules** (Pricing) | You're changing what the business charges. Rare, and admin-only. |
| **Team Access** (Team) | Adding or removing people's access. |
| **Email Settings & Delivery** (Email) | Email types, templates, consent, delivery lookup. |
| **Booking Compliance** (Compliance) | Acceptances, wording, privacy requests. |
| **Assistant Settings** (Assistant) | What Ask Novara may answer, and its review queue. |

## Today

Today is a summary of **today in Eastern Time**, in the order you'd work it.

@screenshot dashboard-overview

**Needs a decision** comes first. Each row is one job: its booking number and customer, when
it's due, why it's on the list and a button for the next action, which opens that exact
record. A job lands here when it is:

- **Needs staffing** — paid and confirmed, no cleaner, visit within two days.
- **Awaiting deposit** — created but unpaid, visit within three days. It can't be staffed
  until it's paid.
- **Missing details** — booking details incomplete, visit within three days.
- **Not closed out** — the visit date passed in the last week and the job isn't marked
  complete.

Unresolved dispatch alerts and offers still waiting on a cleaner are counted at the top of the
same card, with a link to Dispatch & Coverage. If the list can't load, the card says so
rather than showing an empty list.

**Coming up this week** lists today's jobs and the next seven days.

**Live activity** is a running feed of bookings created, offers sent and accepted, jobs
completed and texts going out. It updates by itself.

Then **Metrics**:

**Bookings today** counts every booking scheduled for today that is not cancelled, with how
many are still on and how many are done.

**Booked value today** adds up the prices of today's jobs (final charge where a job has one,
estimate otherwise). It is what the jobs are worth, **not money received**. Underneath: this
month's **completed** job value and **still booked** job value. Re-cleans are $0.

**Active cleaners** is contractors who are both approved and currently active. It is not how
many are working today.

**Pending offers** is job offers nobody has answered yet.

**Last 30 days** plots jobs on the calendar and completed job value. If the daily-metrics view
is empty, the chart is built from bookings instead.

Full admins also see a **Profit & Loss** strip linking to the P&L screen, which is where
collected cash lives.

:::note Booked value and Cleaner Pay will not agree, and that's correct
Booked value counts what jobs are worth. Cleaner Pay counts what contractors are owed. Neither
is money collected. For the money picture — collected, ads, job profit, contribution, ROAS —
use **Profit & Loss**.
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
