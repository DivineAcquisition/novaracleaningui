---
title: Bookings
area: Bookings
category: How the Tool Works
summary: Finding a job, changing it, staffing it, refunding it — and the two things that block an assignment.
whoCanSee: Admins and VAs
where: /admin/bookings
lastVerified: 2026-08-29
order: 2
---

Bookings is the record of every job we've ever taken, and the place you do almost anything to
a specific one: reschedule it, change what's being cleaned, put a cleaner on it, take a
payment, refund it, cancel it, or mark it done.

If a customer is on the phone about an existing job, this is where you go.

## Finding a booking

The screen opens as a list with a search box and two filters above it.

@screenshot bookings-list

The **search box** matches the customer's name, email, phone or the date. It's the fastest
route if you know who you're looking for.

The **status filter** narrows to one kind of booking. Most of the values are self-explanatory;
two aren't:

- **"Pending"** means the booking exists but the deposit hasn't been paid. It is not
  confirmed and it will not be staffed.
- **"Cleaner done · review"** means the cleaner has marked the job finished and it's waiting
  for someone in the office to check it and finalise it.

The **date-range filter** defaults to **All bookings**. The other options — next 14 days,
all upcoming, this week plus next Monday, booked in the last 7 days, service in the last 30
days — narrow it down.

:::warning If you can't find a booking, check the filters first
When any filter is active the screen says **"Filters active — some bookings may be hidden"**
with a **Clear all filters** button next to it. The most common "the booking has vanished"
call is a date filter that excludes it. Clear the filters and search by email before
concluding anything is wrong.
:::

Each row shows the customer and booking number, the date and arrival window, the service and
property, where it is, the price, and a status badge.

@screenshot bookings-row

Two extra labels appear under the status when they apply: **Deposit due** (the deposit
invoice is out and unpaid) and **Can reinstate** (this was cancelled for non-payment and can
be reopened).

## Opening a booking

Click anywhere on the row. A panel slides in from the right titled **Booking #** with the
customer's name, email and phone underneath.

The panel is long and organised top to bottom roughly in the order you'd need it: the summary
first, then money, then the crew, then scheduling changes, then the destructive things at the
bottom. You can't break anything by scrolling through it.

## Staffing a job

The **Assign / replace crew** section is where you put cleaners on a job. It disappears
entirely once a booking is cancelled or completed.

You have three ways to staff:

1. **Assign directly** — pick cleaners from the directory and press **Assign these N
   cleaner(s) (lock in)**. They're on the job; nobody gets a choice.
2. **Offer it** — select cleaners and press **Send offer SMS to N selected**. They get a text
   and can accept or decline.
3. **Offer it to whoever is nearest** — **Offer nearest ranked cleaners** ignores your
   selection and goes down the ranked list.

The directory shows badges next to each contractor — **Available**, **Inactive**, **Pending
approval**, **Not taking jobs** — and there's a **Suggested (nearby & available)** row of up
to six at the top. You can select up to eight people.

When you assign directly, a **Mileage & pay** dialog appears first, where you can add miles,
a mileage amount and a pay adjustment per cleaner. You can skip it with **Assign without
extras**.

### The two things that block an assignment

:::gate The deposit is unpaid
If the customer hasn't paid their deposit, the assignment is refused and you'll see:

> Customer hasn't paid the deposit yet — assignment blocked. Use the override below for
> cash/comp jobs.

An **Assign anyway (override — cash / comp job)** button appears. That override exists for
genuine cash and comped jobs. It is not a way to get around a customer who simply hasn't
paid — if they haven't paid, chase the payment, because staffing an unpaid job means we've
committed a contractor's day to something we may never collect on.
:::

:::gate The crew has no buffer after an earlier job
If the start time leaves no gap after that crew's previous job, the assignment is refused:

> No buffer after this crew's earlier job — assignment blocked.

You can override it, but you must type a reason of **at least 8 characters** — the button
stays disabled until you do, and the reason is logged with your name.

Take this one seriously. Back-to-back jobs with no travel time are the single biggest cause
of late arrivals, and a late arrival on job two becomes a late arrival on jobs three and
four. Operations exists largely to clean up after this.
:::

Once someone is on the job, the crew card gives you **Make lead**, **Check in** (start the
job on their behalf), **Photo link** (text them the before/after upload link), and
**Unassign**. Full admins also see **Increase payout tier**.

## Taking money

**Charge remaining** appears when there's a balance owed and charges the card on file. It
asks you to confirm the amount first.

**Adjust job cost** changes what the job is worth and can refund at the same time. It needs a
reason.

**Account credit** grants or removes wallet credit. Granting needs an amount and a reason;
you can choose whether the customer is emailed and texted about it. Removing always needs a
reason, and you can't remove more than the balance.

**Final balance link** creates the tokenised page the customer pays their remaining balance
on, and can text it to them or copy it.

:::note Credits apply themselves
Wallet credit is applied automatically to the customer's next booking at checkout. You don't
need to do anything to "use" it, and you shouldn't manually discount a booking to account for
credit the customer already has — you'd be giving it to them twice.
:::

## Changing the job

**Adjust service** changes the service type, home size and add-ons, and recalculates. There's
an optional total override. Saving **notifies the customer by SMS and email** — so don't use
it as a scratchpad to see what something would cost.

**Add / edit add-on services** adds add-ons and optionally charges for them. You can **Save
without charging** or **Add & charge**; the charge button is disabled if the change doesn't
increase the total.

**Reschedule booking** moves the date. Disabled once cancelled or completed.

**Delay this booking** pushes today's arrival window by 1, 2 or 3 hours, with a reason and
optional compensation (a discount or a credit). Use this rather than a reschedule when the
crew is simply running late — it's the thing Operations watches, and it tells the customer.

Disabled if the booking is cancelled, completed, or has no arrival window. The apply button
also stays disabled if the delay would push past the end of today.

**Cleaner job notes** has two boxes: **Access notes** (gate codes, parking, pets — the
cleaner sees these) and **Internal / office notes** (the cleaner does not). The save button
stays greyed out until you actually change something.

## Finishing a job

For a booking sitting at **Cleaner done · review**, you get two choices:

- **Finalize & complete booking** — this triggers the final charge, the cleaner's payout and
  the customer emails. Confirm carefully; it's the money-moving one.
- **Send back to cleaner (needs another pass)** — asks for a reason and returns it to them.

For anything else, the button is **Mark booking completed**.

## Cancelling and refunding

Cancelling needs a **cancel reason, and the customer sees it**. Write it accordingly — "spoke
to customer, rescheduling in spring" rather than shorthand.

Then choose the refund: **Full refund**, **Auto (24-hr fee rule)** which applies the standard
policy, or **No refund**.

:::warning Delete is not cancel
At the very bottom is **Delete booking (no notice)**, which permanently removes the booking
and **does not tell the customer anything**. It cannot be undone.

Cancel is what you want essentially always — it keeps the record, applies the refund rules
and tells the customer. Delete is for genuine mistakes, like a duplicate row.
:::

## Photos and the checklist

**Before & after photos** shows what the crew has uploaded, refreshing on its own while
you're looking at it. You can text the cleaner a **Before**, **After** or **Combined** upload
link — but only once someone is assigned. Without a cleaner you get **"Assign a cleaner
first."** You can also upload photos yourself.

**Cleaning checklist** shows the scope for the job and how much of it the crew has ticked
off. Before dispatch there's nothing to see — a checklist is created when the booking is
dispatched.

## Re-cleans

If a booking is a re-clean under the Spotless Guarantee, a banner at the top says so and
links to the original booking. Re-cleans show **No charge** as their price, with the
contractor's pay basis shown separately — the cleaner is still paid, the customer isn't
charged again.

The re-clean workflow itself lives in [Quality Control](/docs/quality-control).

## Common questions

**"The Assign button did nothing."**
It didn't do nothing — it refused. Look for the red message: either the deposit is unpaid or
there's no buffer after the crew's earlier job.

**"I changed the service and the customer got a text I wasn't expecting."**
Adjust service notifies the customer on save. That's by design.

**"The booking says Pending and won't dispatch."**
Pending means the deposit hasn't been paid. It won't be staffed until it is, unless someone
uses the cash/comp override.

**"I need to move a job by two hours today."**
Use **Delay this booking**, not Reschedule. Delay is built for it, handles the customer
message, and can attach compensation.

**"Can I un-complete a booking?"**
Not from here. Completing triggers the final charge and the payout. If it was finalised in
error, raise it with an admin rather than trying to patch it with a refund.
