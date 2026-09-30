---
title: Accounts
area: Accounts
category: How the Tool Works
summary: Business accounts, commercial jobs, insurance certificates, STR hosts, and property-manager portfolios — one list, not nine tabs.
whoCanSee: Full admins only
where: /admin/accounts
lastVerified: 2026-09-13
order: 12
---

Accounts is admin-only. VAs are sent back to the dashboard with **"Admins only."**

That's worth knowing before you go looking: VAs *can* use [Proposals](/docs/proposals) to
take a request and mail an offer. This hub is the ongoing relationship after that.

@screenshot commercial-hub

The sidebar item used to say **Commercial**. It is now **Accounts**. Old
`/admin/commercial` bookmarks redirect here. Sending proposals, firm price, and the deal
pipeline still live on [Proposals](/docs/proposals). Old `?tab=send`, `?tab=pipeline`, and
`?tab=walkthroughs` links still redirect there.

The hub used to have nine sibling tabs (Accounts, Jobs, Book, Recurring, Compliance,
STR, Portfolio, Checklists, Comms). Most of those were the same account opened a
second time. There are three tabs now:

| Tab | What happens here |
|---|---|
| **Accounts** | Every relationship — commercial, office, STR host, property-manager portfolio. Type filter, needs-attention, and **New account**. Certificates, STR ops, checklists, and comms open as tools on this tab, not as extra sidebar-style tabs. |
| **Jobs** | Commercial and office jobs: search, open, cancel / reschedule / refund. **Book a site** is the old Book tab — pick an existing account and site. |
| **Recurring** | Repeating commercial and partner schedules. |

Old links keep working: `?tab=book` opens Jobs with the book form, `?tab=compliance`
opens certificates on Accounts, `?tab=str` filters to STR hosts, `?tab=portfolio`
opens the property-manager console.

## Accounts

Accounts run through **prospect → onboarding → active → paused → offboarded**.

The list is all types by default. Filter to Commercial, Office, STR / Airbnb, or
Portfolio when you only want one line. Click a row for the type-appropriate
sheet: sites and go-live gates on a commercial account, properties and turnovers
on an STR host. Portfolio rows open the property-manager unit registry.

:::gate An account can't be set Active until three things are true
> Can't set Active — signed agreement + payment method + at least one site are required
> first.

All three, no override. An "active" account with no signed agreement is work we can't invoice
for.
:::

### Tools on this tab

The four pills under the tab bar stay on Accounts so you do not leave the
relationship to do the next step:

| Tool | What it was |
|---|---|
| **Certificates** | The old Compliance tab — client COIs and the block they cause. |
| **STR ops** | The old STR tab — host turnovers, crew, batches. Host *accounts* stay in the list. |
| **Checklists** | Published crew lists for commercial jobs. |
| **Comms** | Partnership templates and the send log. |

## Insurance certificates

This is the part of Accounts with the widest blast radius, and it's worth understanding
even if you never touch this screen.

Client certificate statuses are **Current**, **Expiring soon**, **Expired** and **Not on
file**. The warning window is **30 days**.

:::gate An expired or missing certificate blocks every site on the account
Not the site — **the account**. When a client's certificate is expired or missing, it blocks
new bookings, recurring generation, and dispatch for every site they have.

So a lapsed certificate on a multi-site client silently stops all of their work. If a
commercial client's recurring cleans have quietly stopped generating, look here first.
:::

The tiles are **Blocked accounts**, **Expiring soon**, **On override** and **Current**.

**Record a certificate** uploads the PDF with its dates, carrier and policy number. Recording
a valid one lifts the block immediately: *"Certificate recorded — the block is lifted for all
of this account's sites."*

If you upload without an expiration date, the certificate is parked for review and **the block
stays in place** — the screen tells you so.

**Request a renewal** composes and sends the chase.

**Override the block** is the rare escape hatch: a documented reason of at least 10 characters
and a window of 1 to 30 days. It does not change the certificate status — it suspends the
block temporarily so work can continue while the paperwork catches up. **Revoke override
now** ends it early.

An automated monitor warns at **90, 30, 15 and 7 days** before expiry, then daily. It only
alerts; it never changes a status.

### Our own certificate

The **Our certificate of insurance** panel holds Novara's own. It shows **Not on file**,
**Expired** or **Current through {date}**, and lets you upload or replace it and resend it to
clients holding an older copy.

The certificate in force (Spinnaker Insurance Company, policy CSG-00519113-00, effective
July 21, 2026 through July 21, 2027) is also at
`/commercial/novara-certificate-of-insurance.pdf` on the commercial host, so a client can
download it from intake, the proposal, the agreement and onboarding. Signature-time delivery
still emails the PDF.

Remember the fourth dispatch requirement from [Proposals](/docs/proposals): *our* certificate
must have been sent to the client. A deal can be fully priced, signed and billed and still not
dispatch because of that.

## Jobs and recurring

**Jobs** is the Bookings list filtered to commercial and office work. **Book a site** is the
structured path for an existing account (commercial, office, or STR turnover). Creating the
account itself is **New account** on the Accounts list — that used to live on a separate Book
tab next to a second "New commercial job" form.

**Recurring** manages repeating commercial and partner schedules.

## STR

STR *hosts* are rows on Accounts (filter **STR / Airbnb**). Open a host for properties,
per-turnover rates, upcoming and recent turnovers, pause/resume, and the scheduler link.

**STR ops** is the turnover queue — crew pinning, assignment, batches. Mailing the host
agreement and payment setup is **Proposals → Send → STR**, not this tab.

Hosts have their own portal at partner.novaracleaning.com; this is the internal side of it.

## Portfolio

Filter **Portfolio** (or click a portfolio row) for property-manager companies, their unit
registry, standing rates, and onboarding attention. Mailing the portfolio agreement is
**Proposals → Send → Property Manager**.

## Common questions

**"A commercial client's cleans stopped generating."**
Open **Certificates** on Accounts first. An expired certificate blocks the whole account.

**"Can I override an insurance block?"**
Yes, with a documented reason, for 1 to 30 days. Use it to cover a renewal in flight, not to
avoid the conversation.

**"The deal is signed and billed but won't dispatch."**
Almost certainly our certificate hasn't been sent to the client — the fourth requirement.

**"I'm a VA and I can't open this."**
Correct. Use Proposals for walkthroughs, pricing and sending; ask an admin for account,
compliance and STR work.

**"Where did Book / STR / Compliance go?"**
They are still here. Book is **Jobs → Book a site**. STR hosts are on the Accounts list.
Certificates, STR ops, checklists, and comms are the pills on Accounts.
