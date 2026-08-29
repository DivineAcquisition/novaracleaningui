---
title: Team & Access
area: Team
category: How the Tool Works
summary: Giving someone access to the workspace, the VA onboarding queue, and taking access away.
whoCanSee: Full admins only
where: /admin/team
lastVerified: 2026-08-29
order: 15
---

Team is where workspace access is granted and removed. Admin-only — VAs opening it get a card
reading *"Admins only — VA accounts can use the console but only admins can manage team
members."*

@screenshot team-access

Two things live here: the VA onboarding queue at the top, and the direct member list below.

## The VA onboarding queue

The normal route for a new VA. It runs: offer letter → they sign → they fill in details →
you approve → access is provisioned.

### Sending an offer letter

**Send a VA offer letter** takes an email and first name (required), last name, a role —
Operations VA, Sales VA, Recruiting VA or All-in-one VA — and the agreement type, either base
pay or hourly. There's an optional note that goes into the letter, for the rate, start date
or expectations.

:::warning The offer link is valid for 30 minutes
Thirty minutes from sending. If they don't open it in time it expires and you'll need to
resend.

In practice: send it when you know they're at a computer, not at the end of your day. The
queue shows **Offer link live (30 min)** or **Offer link expired** per row so you can see at a
glance.
:::

### The queue sections

**Awaiting your approval**, **Offer sent — awaiting signature**, **Active VAs**, **Still
onboarding**, and a collapsed section for rejected and offboarded people.

Each row shows their status, whether the offer link is live, and whether the agreement is
signed — **Agreement signed ✓** or **NOT signed**.

### Approving

:::gate Approve is disabled until the agreement is signed
The **Approve & provision** button stays greyed out while the row shows **NOT signed**. There
is no override.

Approving provisions a CRM seat and workspace access. Doing that for someone who hasn't
signed a contractor agreement means giving customer data to somebody with no confidentiality
terms in place.
:::

Approving asks you to confirm, then creates their CRM user and their workspace access.

The other buttons are **Resend offer link** for people mid-flight, **Reject**, and **Offboard
(revoke all)** for approved VAs who are leaving.

### What the VA sees

At **team.novaracleaning.com**, three steps: sign the agreement, fill in onboarding details,
wait for approval.

Signing requires ticking that they've read the agreement in full, ticking that they agree,
typing their full legal name (at least 3 characters) and signing. All four, or the button
stays disabled.

The onboarding form requires a **time zone** and **working hours**; phone, experience, tools
and notes are optional.

## Adding someone directly

Below the queue, **Add a VA or admin** takes a work email — which must be
@novaracleaning.com — an optional name, and a role of **VA** or **Admin**. **Add to team**
sends the invite.

Use this for admins, and for people who don't need the VA agreement flow. For a new VA, use
the offer-letter route: it produces a signed agreement, which the direct route does not.

## The member list

Each member with their roles as badges — **admin**, **va** — and the actions: **Resend
invite**, **Make admin**, **Remove VA**, **Revoke**, **Revoke admin**.

:::note What the two roles actually mean
**VA** gets the operational workspace: Dashboard, Bookings, Operations, Cleaners, Internal
Booking, Proposals, Customers, Recurring, Quality Control.

**Admin** adds the money, roles and commercial surfaces: Quotes, Pricing, Commercial,
Payroll, VA Performance, Weekly Report, Team.

Making someone an admin gives them the ability to move money and to grant access to others.
It's a bigger step than it looks in a two-button UI.
:::

Both roles require an @novaracleaning.com email to sign in at all — a role on a personal
address does nothing.

## When someone leaves

**Offboard (revoke all)** from the queue for a VA, or **Revoke** from the member list.

Do it the same day. Workspace access includes customer contact details, addresses and payment
history, and a departure is exactly when that matters.

## Common questions

**"They never got the offer letter."**
Check the address, then **Resend offer link** — and make sure they can open it inside 30
minutes.

**"Approve is greyed out."**
The agreement isn't signed. Resend the link.

**"Can I give someone access to just Payroll?"**
No. There are two levels — VA and admin — and Payroll is in the admin level.

**"They can sign in but the section they need is missing."**
They're a VA and it's an admin-only section. Either it's not for them, or they need admin.

**"Somebody left today."**
Revoke now, don't wait for the end of the week.
