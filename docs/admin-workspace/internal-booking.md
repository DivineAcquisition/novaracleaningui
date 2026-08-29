---
title: Internal Booking
area: Internal Booking
category: How the Tool Works
summary: Taking a booking for a customer on the phone, start to finish, including what blocks the submit button.
whoCanSee: Admins and VAs
where: /admin/csr
lastVerified: 2026-08-29
order: 4
---

Internal Booking is the form you fill in when you're taking a booking yourself — usually with
the customer on the phone. It does everything the public booking funnel does, plus the things
only we can do: adjust the price, choose how they're invoiced, and set up a recurring plan.

It is a single screen with four numbered sections and a **Live quote** rail on the right that
updates as you type.

## Before you start: one-time or recurring

At the top you choose between:

- **One-time clean** — a single booking and invoice.
- **Recurring / Glow** — a membership plan the system re-books on a cycle.

The two paths ask different questions from section 3 onwards, so pick correctly first.
Choosing recurring forces the service to a standard clean, because recurring visits are
standard cleans after the first one.

If the customer already exists, use **Search existing customer or lead** at the top right
first — it fills in their details and links the booking to their record rather than creating
a duplicate.

## Section 1 — Customer

@screenshot internal-booking-customer

Fill in first name, last name, email, phone and the service address. The address field
autocompletes.

**The ZIP is the field that matters most.** It decides the pricing zone, and it decides
whether we can serve the address at all. Once you've typed five digits, one of two things
appears:

- **Served** — with the zone letter and name.
- **"Outside the service area (MD + DC + Northern VA). Offer the waitlist — no quote."**

:::gate An unserved ZIP means no price, at all
When the address is outside our coverage, the quote rail refuses to produce a number and
tells you to offer the expansion waitlist. The submit button stays disabled.

Do not estimate. Do not use a nearby ZIP to get a number out of the system. A price we can't
staff is worse than no price — say plainly that we don't cover the area yet and offer the
waitlist.
:::

If the customer already has wallet credit, the amount shows next to the email field.

## Section 2 — Service

@screenshot internal-booking-service

**Home size** is the band, and the dropdown shows a "from $" price for each so you can steer
the conversation.

**Service type** is one of five: Focused / Single-Area, Standard Clean, Deep Clean, Move-In /
Out, or Deep + Standard. On a recurring plan this is replaced by the membership frequency —
Glow Weekly, Glow Bi-Weekly or Glow Monthly.

**Home condition** — Light, Standard or Heavy — is the biggest lever you control. It's a
judgement from what the customer describes, and it's worth asking about directly rather than
assuming: when was it last cleaned professionally, are there pets, is there build-up in the
bathrooms and kitchen.

**Add-ons** are the pill toggles with prices on them.

If you pick **Focused / Single-Area**, the form switches to a list of areas with prices, and
a minimum is shown. Bedrooms are the only area you can pick more than one of.

There's a collapsible **Property details** block for dwelling type, pets, flooring, parking
notes and who provides supplies. It's optional, but pets and parking in particular save the
crew a phone call.

On a recurring plan you also answer the **first-clean deep clean** prompt: has the home had a
professional deep clean in the last three months? If not, the one-time **$75** deep clean is
added to the first visit. If the customer declines it, the form records that and warns that a
surge may apply on arrival.

## Section 3 — Schedule

Pick a date and an arrival window. Any upcoming date can be booked; dates inside the standard
three-day lead time are marked amber with:

> Short notice. This date is inside the standard 3-day lead time — confirm a crew can cover
> it before booking.

That's a prompt, not a block. But do actually check.

Two notes boxes here: **Access / parking notes** (the cleaner sees these) and **Internal team
notes** (hidden from the customer).

## Section 4 — Payment

For a one-time booking, choose how they're billed:

| Option | What happens |
|---|---|
| **Deposit today + remaining invoiced day-of** | They pay a deposit now; a second invoice goes out the morning of service. |
| **Deposit today + auto-charge on completion** | They pay the deposit and save a card, which is charged when the job is done. |
| **Full payment now** | One invoice, billed immediately. |
| **No invoice — book only** | You're collecting some other way (cash, off-platform). |

The **deposit percentage** defaults to 50%. Focused cleans are automatically set to full
payment now.

There's an optional **price adjustment** here — see below. Then a promo code field, your name
as the booker, and the notification toggles for the pending/pay SMS and the checklist email.

## Adjusting the price

You can override the total. The form tells you which of three situations you're in:

- **Within ±10%** — allowed, but you must pick a reason. The screen says it's within your
  band and will be logged.
- **Beyond ±10%** — allowed. It goes through and an admin is emailed.
- **Below the floor** — refused, with the minimum for that service and size shown.

:::gate The floor cannot be overridden
The message reads: *"Below the floor. The minimum for this service and size is $X — it
protects cleaner pay and cannot be overridden at any level."*

There is no approval that unlocks it and no one to escalate to. The floor is the price below
which the cleaner would earn under $22 an hour for the job. If the customer won't pay it,
change the scope or decline the work. See [Pricing & Quoting](/docs/pricing) for the floor by
home size.
:::

The reason is required whenever you enter an adjusted total — the submit button will list
"Adjustment reason" as missing until you pick one.

## Reading the Live quote rail

The rail on the right is the customer's price, built in front of you.

@screenshot internal-booking-quote-rail

It shows the zone the ZIP resolved to, the base rate for the home size, the condition step
and what it added, a line about demand (currently in shadow mode — not charged), then the
total, and the deposit and day-of split.

**Read it before you quote.** It's the difference between "that'll be about three hundred"
and "it's $298.75 — that's $239 for a home your size, plus 25% because it's a standard
lived-in home, and there's no premium for Columbia." The second answer ends the pricing
conversation.

For a full explanation of every layer, with worked examples, see
[Pricing & Quoting](/docs/pricing).

## Before you can submit

The rail lists what's still missing under **Still needed**. The submit button stays disabled
until that list is empty. It checks:

- First name
- A valid email
- A phone number of at least 10 digits
- A 5-digit ZIP that's actually in the service area
- A service date and a time slot
- **The verbal-agreement confirmation** (one-time bookings only)
- At least one area, if it's a focused clean
- An adjustment reason, if you've overridden the total

:::gate The verbal-agreement checkbox
For one-time bookings you must tick:

> I confirm the client verbally agreed to the Terms of Service, Disclaimer, Refund Policy &
> One-Time Service Agreement over the phone.

This is not a formality. The customer never clicked through the terms themselves — you're
recording that you read them the relevant parts and they said yes. That record is what we
rely on if there's a dispute later, so tick it because it's true, not because it's in the
way.
:::

## Saving a quote instead of booking

**Save as quote** stores the quote without creating a booking, and **locks the price for 48
hours**. It needs the customer's name, email, home size and service type.

Reopen it later from [Quotes](/docs/quotes) or via the link it gives you, and the customer
gets the price you promised — as long as you're inside the window and the details haven't
changed. Past 48 hours it re-prices and shows you the difference, which you should state to
the customer before booking.

## After you submit

**One-time.** You get a confirmation reading **"Booking #NNNNN pending"** with a note that
the SMS and payment link have been sent and the booking stays pending until the deposit
clears. From there you can **Book another** or **Open in Bookings**.

**Recurring.** You get **"Recurring plan created"** and a link to the Recurring hub. The
engine books each cycle from then on.

:::note "Pending" is expected, not a problem
A new one-time booking is pending until the deposit is paid. It won't be staffed while it's
pending. If the customer says they've paid and it still shows pending, give the webhook a
moment, then check the booking in Bookings before doing anything manual.
:::

## Common questions

**"The Create booking button is greyed out."**
Read the **Still needed** list in the rail — it tells you exactly what's missing. The two
most-missed are the verbal-agreement checkbox and the time slot.

**"The price in the rail doesn't match what I expected."**
Check the ZIP resolved to the zone you thought, and check the condition. Those two account
for nearly every surprise.

**"The customer already has credit — should I discount the booking?"**
No. Credit applies itself at checkout. Discounting as well gives it to them twice.

**"They want to pay cash."**
Choose **No invoice — book only**, and note it in the internal team notes.

**"They want weekly but the plan won't save."**
Weekly isn't offered at 3,001 sq ft and above. Quote a custom plan and get an admin involved.
