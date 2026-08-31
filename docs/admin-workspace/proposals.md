---
title: Proposals & Walkthroughs
area: Proposals
category: How the Tool Works
summary: Taking a commercial or office enquiry from first call to a sent proposal, and what blocks each step.
whoCanSee: Admins and VAs
where: /admin/proposals
lastVerified: 2026-08-31
order: 11
---

When a business — an office, a warehouse, a gym, an Airbnb host — wants recurring cleaning,
it does not go through the residential booking flow. It goes through Proposals: request, then
a walkthrough, then a firm price, then a proposal document.

@screenshot proposals-hub

The tabs run left to right in the order work moves through them:

| Tab | What happens here |
|---|---|
| **New request** | Take the enquiry. |
| **Queue** | Assign a walkthrough agent and track the visit. |
| **Firm price** | Turn the findings into a price. |
| **Send** | Build and send the proposal. |
| **Pipeline** | Track sent proposals to signature and billing. |
| **Checklists** | Edit what the walkthrough agent is asked on site. |
| **Settings** | Requester email templates and walkthrough pay. |

:::note A proposal request is not a booking
The screen says it outright: *"Submitting does not create a job booking. It opens a
walkthrough pipeline and emails the requester."*

Nobody is scheduled to clean anything. If a commercial prospect thinks they have a cleaning
booked because they filled in a form, that expectation needs correcting early.
:::

## Taking a request

**New request** has five numbered sections: property type, requester, property address(es),
a type-specific intake, and the walkthrough site contact.

You can add more than one site with **Add another site**. Each takes a street address, city,
state, ZIP, an optional nickname, and the client's stated square footage.

The sidebar lists what's **Still needed** and the submit button stays disabled until it's
empty. If you try anyway you'll get **"Still needed: …"** naming the fields.

On success the requester is emailed to say a walkthrough agent is being assigned.

The walkthrough site contact matters more than it looks — it's who the agent calls when
they're outside a locked building.

## The queue and the walkthrough

The queue filters by stage: **Pending assign**, **Scheduled**, **Conducted**, **Firm price**,
**Excluded**.

For a request pending assignment, open it and set a **visit date and time** and pick an agent
from the **walkthrough-eligible contractors** list, which shows each person's score and
distance. **Assign** is disabled until you've set both, and you'll get *"Pick an agent and a
date/time."* otherwise.

If the list is empty: *"No contractors flagged walkthrough-eligible. Flag them on the Cleaners
tab."* — that's a checkbox on the contractor's profile.

On assignment, the requester is notified and the agent is emailed and texted their checklist
link. That link opens the same section cards a residential job uses — Kitchen, Bathrooms, All
rooms for STR, or the published commercial / office list for those types — then the site
findings that set the firm price. The success message includes the line that matters commercially:

> Pay is owed whether or not this converts.

Walkthrough pay defaults to a **$75.00 flat fee**, or **$35.00 an hour** if set to hourly.
Both are editable in Settings, where the tokenised link lifetime (default **336 hours**, two
weeks) also lives.

The agent fills in the on-site documentation through their own link. You can open the same
thing from the queue, copy the agent's link, or resend it.

## Setting the firm price

The walkthrough moves through: **Requested → Scheduled → Pending price → Firm price set**,
with **Excluded** as a terminal branch for anything we don't service.

:::gate Every finding is required before a price can be set
Recording findings needs all of them: confirmed square footage, facility type, scope level,
condition, obstacle density, restrooms, breakrooms, floors, floor types, service window, crew
size, **and condition photos**.

Try to skip and you get: *"A walkthrough isn't complete without every finding the price
depends on. Still needed: …"*

Try to price without findings: *"A price comes from findings. Record the walkthrough's
findings first."*
:::

Once findings are in, the screen shows a **formula anchor** — what the standard calculation
produces — and you enter the firm price.

:::gate Pricing away from the anchor needs at least 10 characters of reasoning
If your firm price differs from the anchor, you must explain it:

> This is above/below the formula anchor by $X. Say why — obstacle density, access
> requirements, condition — so the rate is defensible later.

The button stays disabled until the reason is 10 characters or more. This is what lets us
justify a rate to a client a year later, or work out why a site is unprofitable.
:::

A site sitting at "conducted" for **3 business days** without a price gets a **STALLED · Nd no
price** badge. Stalled sites are lost deals in waiting.

### How the anchor is calculated

> price = square footage × facility base rate × scope multiplier × size tier multiplier

**Base rate per square foot, by facility type:**

| Facility | Rate |
|---|---|
| Office | $0.12 |
| Warehouse / industrial | $0.07 |
| Retail | $0.11 |
| Restaurant | $0.20 |
| Gym / fitness | $0.15 |
| Medical / clinical | $0.22 |
| Other | $0.12 |

**Scope level:** Light **×0.80**, Standard **×1.00**, Detailed **×1.35**.

**Size tier** — bigger sites cost less per square foot:

| Size | Multiplier |
|---|---|
| Under 1,000 sq ft | ×1.45 |
| 1,000 – 2,499 | ×1.30 |
| 2,500 – 4,999 | ×1.15 |
| 5,000 – 9,999 | ×1.00 |
| 10,000 – 19,999 | ×0.85 |
| 20,000 – 34,999 | ×0.70 |
| 35,000+ | ×0.60 |

**Worked example.** A 1,800 sq ft office at standard scope: $0.12 × 1.00 × 1.30 (the
1,000–2,499 tier) = $0.156 per sq ft, × 1,800 = **$280.80 per visit**. The estimate range
shown to a prospect is **±20%**, so roughly $225 to $337.

**Worked example.** A 32,000 sq ft warehouse at standard scope: $0.07 × 1.00 × 0.70 (the
20,000–34,999 tier) = $0.049 per sq ft, × 32,000 = **$1,568.00 per visit**.

:::note Sites of 5,000 sq ft and over cannot be priced from the formula alone
The walkthrough threshold is **5,000 sq ft**. Below it a site can be formula-priced without a
visit. At or above it, a walkthrough and a firm price are required before the site can be
booked or proposed.

Crew size is suggested from the scope's throughput and the service window, assuming each
extra cleaner adds 75% of a person's output rather than 100% — two people don't clean twice
as fast.
:::

## Sending the proposal

The Send tab builds the document: the account, the sites and their rates, the terms, and the
recipient.

:::gate A client portal account is required before a proposal can go out
The decision-maker must have a portal login on the business account. The Send tab
shows **Create client account** — that emails them an invite to set a password at
partner.novaracleaning.com. Drafts can still be saved without it. The send button
stays disabled, and the API refuses with *"A client portal account is required
before this proposal can go out."*

This is separate from onboarding: they get the login first so the proposal is
tied to an account, not only a forwarded token.
:::

**Frequency** options are Weekly (~4.3 visits a month), Twice a week (~8.7), 3× a week (~13),
Monthly, or a custom cadence. **Term** is month-to-month or a 12-month locked rate. **Billing**
is invoiced — with a cycle and payment terms — or auto-pay, where a card or ACH is captured
after signing and never charged before.

The rail shows per-visit and estimated monthly, and lists what's **Still needed**.

:::gate Every site needs a firm price before anything can go out
If any active site lacks a firm price, the send button stays disabled and the screen says
*"Every site needs a firm price before this can go out"* with the blocking sites listed.

There's no override. A proposal with a guessed rate on one site is a proposal we'll have to
retract.
:::

Sent proposals expire after **14 days**, with a reminder **3 days** before.

The proposal link is tokenised — as the screen says, **forwarding it is the credential**.
Anyone with the link can open it.

## The pipeline

The pipeline tracks deals through their stages: **Pricing pending → Firm price ready →
Proposal sent → Proposal accepted → Agreement out for signature → Billing setup pending →
Dispatch-eligible**, with **Changes requested**, **Proposal expired** and **Blocked on
certificate** as branches.

A site becomes **dispatch-eligible** only when all four of these are true:

1. It has a firm price.
2. The agreement is signed.
3. Billing is configured.
4. Our certificate of insurance is not blocking.

:::gate All four, or no work gets scheduled
Missing any one means the site cannot be dispatched. The most commonly forgotten is the
fourth — see [Commercial](/docs/commercial) for how insurance blocks work.
:::

## Checklists and settings

**Checklists** has two layers:

1. **Scope checklist** — the same Kitchen / Bathrooms / All rooms cards as a residential
   job (or the published commercial / office list). Load a public `/checklist` template,
   edit the lines, save. The tokenized walkthrough link ticks these items on site.
2. **Findings** — square footage, floors, access, exclusions. These still set the firm
   price. Universal findings apply to every type; each type adds its own.

Changes take effect for new walkthroughs immediately — there's no deploy.

**Settings** holds the requester email templates and the walkthrough pay values above.

## Common questions

**"The client gave me the square footage — do I still need a walkthrough?"**
At 5,000 sq ft and above, yes. Below it a formula price is allowed, but a walkthrough is still
the safer basis for a recurring contract.

**"Set firm price is greyed out."**
Either the findings aren't recorded, or your price is off the anchor and the reason is under
10 characters.

**"The prospect hasn't replied."**
Proposals expire after 14 days and a reminder goes at 11. After it expires, build a new
version rather than reviving the old one.

**"Do we pay for a walkthrough that doesn't convert?"**
Yes. $75 flat by default, owed regardless.

**"Why can't I send this proposal?"**
Either a site has no firm price, or the account has no client portal login.
The screen lists which. Use **Create client account** if the login is missing.
