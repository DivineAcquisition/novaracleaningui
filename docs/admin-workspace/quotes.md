---
title: Quotes
area: Quotes
category: How the Tool Works
summary: Finding a saved quote, sending a customer their scope checklist, and turning a quote into a booking.
whoCanSee: Full admins only
where: /admin/quotes
lastVerified: 2026-08-29
order: 13
---

Quotes holds two lists: quotes saved from [Internal Booking](/docs/internal-booking), and
custom quote requests that came in from the website.

@screenshot quotes-list

:::warning VAs save quotes here but cannot open this screen
Anyone can save a quote from Internal Booking, and it lands in this list. **Only full admins
can open this screen.**

So a VA who saves a quote can't come back and find it. They can reopen it from the link the
save gave them, but browsing the list is admin-only. Worth knowing before you tell a VA to
"go look in Quotes."
:::

## Finding a quote

Search matches name, email, phone and ZIP. The status filter covers **Draft**, **Converted**,
**Expired** and **Pending**.

**Saved quotes** shows customer, service, price, status and when it was saved. **Website
requests** shows name, contact, square footage, status and when it came in.

Empty states are literal: *"No saved quotes yet. Save one from Internal Booking."*

## Working a quote

Open one and you get the customer's details, the service and home size, the estimate, their
preferred date, the status, and any team notes.

**Open in Internal Booking** at the bottom is the main action — it loads the quote back into
the booking form with everything filled in.

:::note The 48-hour lock decides what the customer pays
A saved quote locks its price for **48 hours**. Reopen it inside that window and the customer
gets the price you promised.

Outside it, the quote re-prices and the booking screen shows you the old price, the new price
and the difference. **Say the new number to the customer before booking.** The worst version
of this is a customer discovering it at checkout.

The lock also stops applying if the job itself changed — different home size, service or
address. That's a different job, so it's a different price.
:::

## Sending the customer their checklist

The **Customer checklist** section emails the full scope checklist and texts the public link
for that service type. Four buttons: **Email checklist**, **Text checklist link**, **Email +
SMS**, and **Copy link**. There's a **Preview customer view** link so you can see what they'll
get.

This is one of the highest-value things on the screen. Most "you didn't clean X" complaints
are scope misunderstandings, and the checklist is what prevents them. Sending it with the
quote sets the expectation before any money changes hands — and it's the document
[Quality Control](/docs/quality-control) leans on when classifying a complaint as scope
confusion rather than a quality miss.

The **Membership benefits** section works the same way, with its own preview.

:::gate The send buttons need the contact details they use
- Email buttons are disabled without an email — *"No email on this quote"*.
- SMS buttons are disabled without a phone — *"No phone on this quote"*.
- **Email + SMS** needs both.
:::

## Website requests

Custom quote requests from the website carry a square footage and notes rather than a full
service selection, so you pick the service type — standard/maintenance, deep clean, move
in/out, or combo — before sending a checklist. Otherwise they behave the same.

## Common questions

**"A VA says they saved a quote and can't find it."**
Expected — this screen is admin-only. Find it for them, or have them use the link from when
they saved it.

**"The quote's price changed."**
The 48-hour lock expired, or the job details changed. The booking screen shows the difference.

**"Can I extend a lock?"**
No. Re-quote and tell the customer the current price.

**"They never got the checklist."**
Check there's an email on the quote, then use **Email + SMS** and confirm both go.
