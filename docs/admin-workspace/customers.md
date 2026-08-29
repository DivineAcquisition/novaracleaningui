---
title: Customers, Credits & Referrals
area: Customers
category: How the Tool Works
summary: Customer accounts, the credit wallet, refunds, billing links — and how referrals actually work.
whoCanSee: Admins and VAs (impersonation and deletion are admin-only)
where: /admin/customers
lastVerified: 2026-08-29
order: 10
---

Customers is the account-level view: everything about a person rather than a single job. Use
it for credits, refunds, billing portal links, password resets, and finding someone by their
referral code.

@screenshot customers-list

Search matches name, email, phone, ZIP **and referral code** — which is the fast way to answer
"someone gave me this code, whose is it?"

## The customer panel

Click a row. The heading shows the customer's name and, underneath, when they joined and
their referral code (or **No referral code**).

The account buttons across the top:

| Button | What it does |
|---|---|
| **Edit profile** | Name, email, phone, address. |
| **Send billing portal link** | Emails them a Stripe portal link to manage their card. |
| **Copy portal link** / **Open Stripe portal** | The same link for you. |
| **Send password reset** | For customers locked out of the portal. |
| **Log in as customer** | Admin only. See what they see. |
| **Re-sync to GHL** | Pushes their record to the CRM. |
| **Delete customer** | Admin only, and guarded. |

Below that, two tabs: **Bookings** and **Credit wallet**.

:::warning Deleting a customer is permanent
You have to type their full name to enable the button. That friction is the point — deleting
removes the account, not just their access. If someone wants to stop hearing from us, that's
an unsubscribe, not a deletion.
:::

## Refunds from here

Each booking that isn't already cancelled or completed offers **Refund + cancel** (only when
there's a payment to refund) and **Cancel (no refund)**.

For anything more specific — a partial refund, a job-cost adjustment, a scope dispute — use
the booking's own panel in [Bookings](/docs/bookings), which has finer controls.

## The credit wallet

The wallet tab shows available credit, lifetime granted and applied, and the full history.

**Grant credit** takes an amount (defaulting to **$50**), a source — Admin grant, Refund as
credit, Promo, Loyalty perk / goodwill, or Service recovery / adjustment — and a **reason the
customer will see**. There's a toggle, on by default, to email and text them about it.

The reason is customer-visible, so write it as a sentence to them: *"Sorry about the late
arrival on 6/12"*, not *"goodwill per MW"*.

**Remove credit** needs an internal-only reason and won't let you remove more than the
balance — you'll get *"Only $X available to remove."*

:::note Credit applies itself
Wallet credit is applied automatically to the customer's next booking at checkout. Nobody has
to "use" it, and you should not also discount a booking to account for credit they already
hold — that gives it to them twice.
:::

## Referrals

Referrals are not a section of the workspace. There is no referrals screen, no queue and no
approval step — it runs by itself and surfaces in a few places. Worth knowing, because people
go looking for a screen that doesn't exist.

**How a code comes into being.** Every customer gets an 8-character code, generated
automatically — after their first payment clears, or when a VA books them internally.
Ambiguous characters are left out so it can be read over the phone.

**What the customer is told.** The customer-facing wording is **"Give $50, Get $50"**, and the
share text offers the friend 25% off their first booking.

**What actually happens in the system.**

1. The friend books with the code on their booking.
2. When their deposit or payment clears, a pending referral is recorded worth **$50.00**.
3. When that job is **completed**, the referrer is granted **$50.00** of wallet credit, marked
   as coming from a referral.

So the reward lands on job completion, not at booking. The referral credit has **no expiry
date** set on it.

:::warning The "25% off for the friend" is not applied by the system
The customer-facing copy promises the friend 25% off their first booking, and the share text
repeats it. What the code does in the current flow is attach the referral for attribution —
**the friend's booking is not automatically discounted**.

So if a customer calls saying their friend's code didn't take 25% off, they are not confused
and it is not a glitch. Deal with it as a manual credit and flag the mismatch. Somebody needs
to decide whether the copy or the behaviour is wrong.

There is also an older referral routine still in the codebase that marks a referral redeemed
without granting any wallet credit. It does not appear to be on the live path, but its
existence is worth knowing if referral numbers ever look off.
:::

**Where you see it.** In the workspace: the referral code in the customer panel heading, code
matching in search, and referral-sourced rows in the wallet history. The customer sees their
own code and share link in their portal.

## Creating a customer

**New customer** takes first name and email as required, plus last name, phone and ZIP. It
creates the account and emails them a sign-in link. You'll get *"Customer created ·
password-set email sent."*

## Common questions

**"They say they have credit but it isn't showing."**
Check the wallet tab for the actual balance. Credit from a referral only lands when the
referred job is **completed**, not when it's booked.

**"Their friend used the code and got no discount."**
Correct behaviour today, wrong against the copy. Apply a manual credit and flag it — see the
warning above.

**"They can't log in to the portal."**
**Send password reset** first. If they never had an account, create one — that emails a
sign-in link.

**"Refund or credit?"**
A refund returns money; a credit keeps them as a customer. Credit is generally the better
service-recovery tool, but never pressure someone into it if they've asked for their money
back.

**"Can I see what the customer sees?"**
**Log in as customer**, admins only.
