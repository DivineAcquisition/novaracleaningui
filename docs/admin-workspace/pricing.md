---
title: Pricing & Quoting
area: Pricing
category: How the Tool Works
summary: How a price is built layer by layer, what each layer does, and how far you may move a number.
whoCanSee: Full admins only (the Pricing screen). Every VA sees prices on the booking screen.
where: /admin/pricing
lastVerified: 2026-08-29
order: 3
---

Every residential price in the workspace is built the same way, in the same order, every
time. Two customers with the same home, the same service, the same date and the same
address get the same number — nothing about who they are, what device they used, or how
they found us enters the calculation anywhere.

That matters for you practically: **you can always explain a price.** The booking screen
shows you every layer as a separate line, so when a customer asks "why is it that much,"
you have the answer in front of you rather than having to justify a total you can't break
down.

## How a price is built

The order never changes:

1. **Base rate** — the published price for that home-size band and that service.
2. **× Condition** — how much work the home actually needs.
3. **× Zone** — which part of our service area the address is in.
4. **× Demand** — how busy that date is. *(Not charging today — see below.)*
5. **Ceiling and floor** — two guardrails that can pull the number back.
6. **+ Add-ons and the same-day fee** — flat amounts, added last, never multiplied.

The last point is the one people get wrong most often. **Add-ons and the same-day fee are
never multiplied by anything.** A $30 fridge add-on is $30 whether the home is in Zone A
or Zone C, whether it's a light home or a heavy one.

### The base rate

The base rate depends on the home-size band and the service type. These are the current
published rates. They are quoted at Zone B, which is our standard zone — Zone A and Zone C
adjust from here.

| Home size | Standard | Deep | Move-In / Move-Out |
|---|---|---|---|
| 0 – 999 sq ft | $150.00 | $225.00 | $300.00 |
| 1,000 – 1,500 sq ft | $189.00 | $284.00 | $378.00 |
| 1,501 – 2,000 sq ft | $239.00 | $359.00 | $478.00 |
| 2,001 – 2,500 sq ft | $279.00 | $419.00 | $558.00 |
| 2,501 – 3,000 sq ft | $339.00 | $509.00 | $678.00 |
| 3,001 – 3,500 sq ft | $379.00 | $569.00 | $758.00 |
| 3,501 – 4,000 sq ft | $439.00 | $659.00 | $878.00 |
| 4,001 – 4,500 sq ft | $489.00 | $734.00 | $978.00 |
| 4,501 – 5,000 sq ft | $539.00 | $809.00 | $1,078.00 |

A **Deep + Standard combo** is the standard price plus the deep price for that band added
together. Anything over 5,000 sq ft has no published rate — the screen will tell you it
needs a custom quote, and you should flag it rather than guess.

:::drift Two base price tables are on file, and the system knows it
The pricing configuration currently holds **two** base price tables — the "Training Guide"
table (the one above) and an older "later sqft model" with different, generally lower
numbers. The system is set to quote from the Training Guide table, and it is flagged as
**not reconciled**, which is why the Pricing screen shows a banner about it.

Nothing is broken and nothing is being mis-quoted: quotes come from the Training Guide
table. But the discrepancy is real, it is unresolved, and an admin needs to confirm which
table is authoritative and clear the flag. Until then, if you see a price in an older
document that doesn't match the table above, that is probably why. **The table above is
what customers are actually charged.**
:::

### Condition

| Condition | What it means | Effect |
|---|---|---|
| Light | Well-kept, regular upkeep | no change |
| Standard | Typical lived-in home | **+25%** |
| Heavy | Build-up, neglect, or post-event | **+60%** |

Condition is the single biggest lever on a residential price, and it's the one you set from
what the customer tells you. Getting it wrong in either direction is expensive: too low and
the crew is underpaid for the work, too high and we lose the job.

:::warning There is a second, different set of condition multipliers in the system
The focused-clean settings hold their own condition list (light, normal, heavy, severe with
different values). **That set is not what prices a normal booking.** The three in the table
above are the ones the quote uses. If someone quotes you a "severe" condition or a ×1.5,
they are reading the wrong list.
:::

### Zone

The zone comes from the service address ZIP — you never pick it. There are three:

| Zone | Effect | Roughly where |
|---|---|---|
| **A — Premium** | **+15%** | Bethesda, Potomac, Chevy Chase, Rockville, Silver Spring, Takoma Park, DC north-west, Arlington, McLean, Vienna, Falls Church, Old Town Alexandria |
| **B — Standard** | no change | Rest of Montgomery County, Prince George's, Columbia, Ellicott City, Laurel, Bowie, College Park, rest of DC, Fairfax County, Ashburn/Leesburg/Reston/Herndon |
| **C — Outer** | **−10%** | Frederick, Hagerstown, Annapolis, Glen Burnie, Baltimore city and suburbs, Eastern Shore, Southern and Western Maryland, Prince William County, Manassas |

Zone B is the default. If a ZIP is inside our coverage but hasn't been assigned to a zone
yet, it falls to Zone B rather than failing — so a brand-new ZIP never breaks a quote.

**If the address is outside the service area entirely, you get no price at all.** The screen
says so and tells you to offer the expansion waitlist. Do that. Do not estimate a number for
an unserved address.

@screenshot pricing-zones

### Demand

Demand pricing would move the price based on how booked the date already is, how short the
notice is, whether it's a weekend or month-end, and how thin cleaner coverage is in that zone
that day.

:::note Demand is currently switched off for charging
Reactive pricing is in **shadow mode**. The system works out what it *would* charge and
records it, but the customer is charged the zone price. You will see a line on the quote
saying exactly that.

So in practice, today: **demand adds nothing to any quote.** If a customer asks whether we
surge-price, the honest answer is that we don't currently.
:::

Two things stay true even when it is switched on: **members are exempt** — their plan rate
is what they bought — and **focused cleans are exempt**, because they already sit close to
the minimum.

You can check the current state yourself on the Demand tab — the two switches at the top are
the master switch and shadow mode, and the badges in the page header say **Reactive: off**
and **Shadow: on**.

@screenshot pricing-demand

### The ceiling and the floor

Two guardrails sit at the end of the calculation.

The **ceiling** caps zone and demand combined at **1.35×** the base-and-condition price. It
exists so no combination of multipliers can produce a number a customer would find
unreasonable.

The **floor** is more important day to day, and it is absolute. It is the lowest price at
which the cleaner still earns at least **$22.00 an hour** for the hours that job is expected
to take. Below that we would be funding a discount out of the cleaner's pay, so the system
does not allow it — **not by any adjustment, at any level, by anyone.**

| Home size | Expected hours | Crew | Floor (single visit) | Floor (Deep + Standard combo) |
|---|---|---|---|---|
| 0 – 999 sq ft | 2 | 1 | $118.92 | $237.84 |
| 1,000 – 1,500 sq ft | 2.5 | 1 | $148.65 | $297.30 |
| 1,501 – 2,000 sq ft | 3 | 1 | $178.38 | $356.76 |
| 2,001 – 2,500 sq ft | 3.5 | 1 | $208.11 | $416.22 |
| 2,501 – 3,000 sq ft | 4 | **2** | $440.00 | $880.00 |
| 3,001 – 3,500 sq ft | 4.5 | **2** | $495.00 | $990.00 |
| 3,501 – 4,000 sq ft | 5 | **2** | $550.00 | $1,100.00 |
| 4,001 – 4,500 sq ft | 5.5 | **2** | $605.00 | $1,210.00 |
| 4,501 – 5,000 sq ft | 6 | **2** | $660.00 | $1,320.00 |

Notice the jump at 2,501 sq ft. That's where jobs are staffed with two cleaners instead of
one, so the floor roughly doubles. **This is the single most surprising thing in pricing**,
and there's a worked example of it below.

@screenshot pricing-guardrails

## Worked example: a straightforward Standard Clean

A 1,700 sq ft house in Columbia, standard condition, Standard Clean, no add-ons, booked for
next week.

| Step | Working | Running total |
|---|---|---|
| Base rate — 1,501–2,000 sq ft, Standard | | **$239.00** |
| × Condition: standard | +25% → +$59.75 | **$298.75** |
| × Zone B | no change | **$298.75** |
| × Demand | shadow mode — not charged | **$298.75** |
| Floor check | floor is $178.38, we're above it | **$298.75** |
| Add-ons / same-day | none | **$298.75** |

**The customer pays $298.75.** The deposit is half — $149.38 — and $149.37 is due on the
day. (The odd split is just the rounding of an odd number of cents.)

Here is that exact quote on the actual screen:

@screenshot internal-booking-quote-rail

Read the rail top to bottom and it tells the same story as the table: base rate, then the
condition step, then the zone, then a note that demand isn't being charged, then the total.

## Worked example: the floor pushing a price up

A 2,700 sq ft home in Zone B, standard condition, Standard Clean.

| Step | Working | Running total |
|---|---|---|
| Base rate — 2,501–3,000 sq ft, Standard | | **$339.00** |
| × Condition: standard | +25% → +$84.75 | **$423.75** |
| × Zone B | no change | **$423.75** |
| **Floor applied** | floor for this band is **$440.00** | **$440.00** |

The calculation produced $423.75, but that band is staffed by two cleaners for four hours,
and $423.75 wouldn't leave them $22 an hour. So the price is pushed up to **$440.00** and
the rail shows a "Floor applied" line explaining why.

This surprises people. If a customer pushes back on a 2,500-plus sq ft quote feeling higher
than they expected relative to a smaller home, that's the reason, and it's a reason you can
say out loud: it takes a two-person crew, and we don't pay crews less than $22 an hour.

## Worked example: a heavy deep clean in Zone A with add-ons

A 2,300 sq ft home in Bethesda in heavy condition, Deep Clean, with inside-the-fridge and
inside-the-oven.

| Step | Working | Running total |
|---|---|---|
| Base rate — 2,001–2,500 sq ft, Deep | | **$419.00** |
| × Condition: heavy | +60% → +$251.40 | **$670.40** |
| × Zone A | +15% → +$100.56 | **$770.96** |
| × Demand | shadow mode — not charged | **$770.96** |
| + Inside the fridge | flat $30.00 | **$800.96** |
| + Inside the oven | flat $30.00 | **$830.96** |

**$830.96.** Note the add-ons went on at face value at the very end — they were not
increased by the heavy condition or the Zone A uplift.

## Worked example: Move-In/Move-Out, where two add-ons are free

A 1,200 sq ft rental in Frederick, Move-In/Move-Out, standard condition, and the customer
asks for inside the fridge and inside the oven.

| Step | Working | Running total |
|---|---|---|
| Base rate — 1,000–1,500 sq ft, Move-In/Out | | **$378.00** |
| × Condition: standard | +25% → +$94.50 | **$472.50** |
| × Zone C | −10% → −$47.25 | **$425.25** |
| + Inside the fridge | **included free** on Move-In/Out | **$425.25** |
| + Inside the oven | **included free** on Move-In/Out | **$425.25** |

**$425.25.** Inside-the-fridge and inside-the-oven are **included at no charge on
Move-In/Move-Out jobs only**. The screen shows them with a $0.00 and an "included free"
note. Don't quote them as extras on a move-out — the customer will see $0 on the breakdown
and you'll have said something different.

## Focused cleans

A focused clean is priced per area rather than by home size, and the areas stack.

| Area | Price |
|---|---|
| Kitchen | $65.00 |
| Bathroom | $65.00 |
| Living / common area | $65.00 |
| Other single area | $65.00 |
| Bedroom | $50.00 — this is the only one you can pick more than one of |

There is a **$65.00 minimum**. Condition and zone still apply on top of the area total;
demand never does.

**Example.** Kitchen, one bathroom and two bedrooms in Zone B, standard condition:
$65 + $65 + ($50 × 2) = $230.00, then +25% for standard condition = **$287.50**.

**Example with the minimum and the same-day fee.** One bedroom, in Zone B, booked for
today: the bedroom is $50, which is below the $65 minimum, so the base becomes $65.00. Then
+25% condition = $81.25. Then the flat same-day fee of $50.00 goes on at the end:
**$131.25**.

## The same-day fee

**$50.00 flat**, added at the very end and never multiplied. It applies when the service
date is today. The same-day cut-off is **2:00 pm Eastern**.

Same-day work is not guaranteed — it depends on someone actually being free. If we can't
staff it, the booking is cancelled and the customer is refunded in full, **including the
same-day fee**, automatically. Say that up front; it's a genuinely good answer to "what if
nobody can come?"

## Memberships

Membership pricing is a published monthly rate per home size. Zone still applies. Demand
never does — a member's rate is part of what they bought.

| Home size | Glow Monthly | Glow Bi-Weekly | Glow Weekly |
|---|---|---|---|
| 0 – 999 sq ft | $129 | $199 | $359 |
| 1,000 – 1,500 sq ft | $159 | $249 | $449 |
| 1,501 – 2,000 sq ft | $199 | $319 | $569 |
| 2,001 – 2,500 sq ft | $239 | $369 | $659 |
| 2,501 – 3,000 sq ft | $279 | $449 | $799 |
| 3,001 – 3,500 sq ft | $319 | $499 | **not offered** |
| 3,501 – 4,000 sq ft | $369 | $579 | **not offered** |
| 4,001 – 4,500 sq ft | $409 | $649 | **not offered** |
| 4,501 – 5,000 sq ft | $459 | $719 | **not offered** |

**Weekly is not available at 3,001 sq ft and above.** If you try, the screen refuses and
tells you to quote a custom plan. That is not a bug — don't work around it.

New members also pay a **one-time $75.00 first-clean deep clean** on the first visit, unless
the home has had a professional deep clean in the last three months. If the customer
declines it, the screen records that, and a surge may apply on arrival if the crew finds the
home needs it.

**Worked example.** Glow Bi-Weekly on a 1,700 sq ft home in Zone A, first month:
$319.00 published rate, +15% for Zone A = $366.85 a month, plus the one-time $75.00
first-clean deep = **$441.85 for the first month**, then $366.85 a month after that.

:::drift Two membership price lists disagree, and one is stale
The live pricing configuration and an older price list inside the application code do not
match in two places:

- **0–999 sq ft weekly** — the live configuration says **$359**; the older list says $349.
- **Weekly at 3,001 sq ft and above** — the live configuration says **not offered**; the
  older list still carries prices ($899, $1,039, $1,159, $1,279).

The table above is the live configuration, which is what the quoting screen actually uses.
The older list is a fallback that only comes into play if the live configuration can't be
read. Someone should reconcile the two; until then, quote the table above.
:::

## How far you can move a price

You can adjust a quote on the booking screen. Three rules govern it:

1. **Within ±10%** — fine, but **a reason is required**. Pick one from the list; the note is
   logged against the booking.
2. **Beyond ±10%** — still allowed. It goes through, and an admin is emailed about it. It is
   not blocked and you are not waiting on an approval.
3. **Below the floor** — **never.** Not with a reason, not with an approval, not by an admin.
   The screen tells you the floor for that service and size and refuses.

:::gate The floor cannot be overridden by anyone
This is worth being clear about because it's the one people try to escalate. The floor is
not a policy someone can waive — the software refuses the number. If a job genuinely cannot
be sold at the floor, the answer is to change the scope (fewer areas, a different service)
or to walk away, not to find someone senior enough to force it through.

The reason: cleaner pay is a percentage of the final job value. Discounting below the floor
takes money out of the cleaner's pocket, not out of our margin.
:::

The reasons you can pick are: competitor price match, repeat customer goodwill, service
recovery after a prior issue, scope clarified on the call, advertised promo honoured, and
other (which requires a note).

## Quote locks

When you **Save as quote**, the price is locked for **48 hours**. Reopen that quote inside
the window and the customer gets the price you promised, even if something changed
underneath.

After 48 hours the lock expires and the quote re-prices. The screen shows you the old price,
the new price and the difference. **Re-state the new price to the customer before booking** —
don't let them find out at checkout.

If the booking details change (different home size, different service, different address),
the lock no longer applies, because it was a lock on a different job. The screen tells you
that too.

## Where the numbers on this page come from

Everything above was generated from the live pricing configuration and run through the same
calculation the booking screen uses, rather than typed in by hand. Specifically: pricing
configuration **version 3**, read on **2026-08-29**, with the cleaner-pay percentages read
from the live pay-rate table.

That matters because it means a figure here can only be wrong if the software itself is
wrong. It also means these figures go stale the moment someone changes the configuration —
which is what the "last verified" date at the top is for.

## Common questions

**"The price changed between the quote and the booking."**
Almost always an expired 48-hour lock, or a detail that changed. The rail tells you which.

**"Why is this 2,600 sq ft home more than I expected?"**
The floor. That band is staffed by two cleaners and the floor is $440.

**"Can I just take 20% off for this customer?"**
Yes, if it stays above the floor. It'll go through and an admin will be emailed. If it
drops below the floor, no.

**"The customer's ZIP isn't found."**
Either it's not five digits yet, or the address is outside the service area. If it's
outside, offer the waitlist — do not quote a price.

**"Do we charge more on weekends?"**
Not today. Weekend demand is configured, but demand pricing is in shadow mode, so it isn't
being charged.
