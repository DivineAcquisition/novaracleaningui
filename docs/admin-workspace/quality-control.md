---
title: Quality Control
area: Quality Control
category: How the Tool Works
summary: Logging complaints, running a Spotless Guarantee re-clean, and building the file that defends a disputed job.
whoCanSee: Admins and VAs
where: /admin/qc
lastVerified: 2026-08-29
order: 8
---

Quality Control is where complaints are recorded, re-cleans are decided, and the evidence for
a disputed job is assembled.

The line at the top of the screen is the whole philosophy: *"A documented job is a defensible
job."* When a customer disputes a charge months later, what decides it is whether we have
photos, a completed checklist and a written record. This screen is how that gets built.

@screenshot qc-overview

## The four numbers at the top

**Open issues** — everything not yet resolved, broken down by severity.

**Documentation compliance (30d)** — the percentage of completed jobs with documentation. The
card turns red **below 80%**. This is the leading indicator: undocumented jobs are the ones we
lose disputes on.

**Issue rate (30d)** — issues as a percentage of completed jobs.

**Undocumented jobs** — the specific jobs with nothing on file. Anything above zero is
future exposure.

## Logging an issue

**Report issue** opens the form. Find the job first — by customer email, name or booking
number — because every issue attaches to a job, and the job's documentation becomes the
evidence.

Then set:

- **Issue type** — Complaint, Re-clean, Damage, No-show, Late arrival, Quality flag, Payment,
  Site finding, Add-on, or Other.
- **Severity** — Low, Medium, High or Critical. High and critical alert an admin on Discord
  immediately.
- **A short title** and **the details** — what the customer said, what was found.

For complaints, re-cleans and quality flags there's a checkbox, **ticked by default**, to
request a re-clean.

The **Create issue** button stays disabled until there's a title.

## Working an issue

Open an issue and you get the description, the job's evidence, who was on the crew, and the
audit trail.

The **Job evidence** badges tell you immediately whether you're in a strong position:
**Documented ✓** or **NOT documented**, the Drive mirror status, checklist percentage and
photo count, with links to the Drive folder and the dispute packet.

:::note Photos leave Supabase after 14 days
Photo copies are purged from the workspace after **14 days** — the originals live in the
Drive folder. If you're working an old issue and the photos aren't showing inline, that's
expected. Use the Drive folder link.
:::

The status buttons are **Investigating**, **Awaiting customer**, **Escalate**, **Add note
only** and **Resolve**.

:::gate Resolving requires a note
Both **Resolve** and **Add note only** stay disabled until you've written something. The
footer says why: *"Resolving requires a note — it becomes the permanent resolution record."*

Six months later, "resolved" on its own tells nobody anything. The note is the record.
:::

You can attach contractors to the case, and take an accountability action against them
directly from here — which links the conduct action to the evidence, exactly the documented
reason the [Cleaners](/docs/cleaners) accountability ladder requires.

## The Spotless Guarantee re-clean

When an issue involves a re-clean, complaint or quality flag, a **Spotless Guarantee —
re-clean** section appears.

The guarantee window is **48 hours**. The badge tells you whether you're inside it —
**Inside 48h window** — or outside, where it reads **Outside window — honor at discretion**.
Outside the window is a judgement call, not an automatic no.

### Classifying it

You must classify before you can approve. Three options, and the choice has consequences:

| Classification | Meaning | Hits the cleaner's score? |
|---|---|---|
| **Valid — quality miss** | We didn't clean it properly. | **Yes** |
| **Valid — scope confusion** | It was never in scope, but the customer reasonably expected it. | No |
| **Not supported** | Outside the guarantee. | No |

:::warning Classify honestly — it decides whether a contractor is penalised
"Quality miss" counts against the contractor's quality score. "Scope confusion" doesn't,
because it's our communication that failed, not their cleaning.

Reaching for "quality miss" to make an unhappy customer feel heard punishes someone who did
nothing wrong. If the customer expected something that was never in the scope, that's scope
confusion, and the fix is the scope sheet, not the cleaner.
:::

You can still approve a re-clean on a **not supported** case using **Approve as goodwill
anyway**.

### Scope and dispatch

The re-clean scope is **Targeted** by default — just the areas that were missed. **Full
re-service** is for jobs that substantially failed, and needs a separate admin approval
checkbox before the approve button enables.

By default the original cleaner is offered the re-clean. There's a checkbox for when the
customer has asked for a different team.

Then: **Preview pay**, **Save classification**, **Approve re-clean**, and **Dispatch**. If
the original cleaner declines, **Original declined — ranked dispatch** offers it out more
widely.

The re-clean shows as **No charge** on the customer's side. The contractor is still paid.

## Documentation

The Documentation tab lists jobs and their evidence, filtered by all, undocumented, or Drive
status. **Run mirror now** pushes documentation to Drive; individual rows can be retried.

An undocumented completed job is a job we cannot defend. If that list is long, the fix is
upstream — crews not uploading photos — and belongs in a conversation with dispatch and the
contractors, not in this screen.

## The dispute packet

**Full case file** assembles everything about a job into one view, and the dispute packet PDF
contains:

1. Job completion and documentation summary — booking, client, service, address, who cleaned
   it, when it completed, photo count.
2. The payment record, live from Stripe.
3. Notes.
4. **The policies the client agreed to, with section citations** — 14 policy references and
   their URLs.
5. The complaint and quality-control record for the job.
6. Checkout and agreement acceptance evidence.
7. Every before and after photo.
8. The executed service agreement.

That is what gets sent to a payment processor in a chargeback. It is also why the discipline
about photos and checklists matters — the packet is only as strong as what the crew uploaded.

## Re-cleans and Scope Adjustments tabs

**Re-cleans** reports on volume, absorbed cost, quality misses and serial requesters. A
customer is flagged as a serial requester at **2** requests; a contractor is flagged for
repeat quality misses at **2 in 90 days**.

**Scope Adjustments** covers jobs that turned out bigger than booked — the additional revenue,
which were unsupported, which were disputed, broken down by reason, cleaner and customer.

## Common questions

**"The customer complained but the job was fine."**
Log it anyway, classify it accurately, and resolve it with a note. The record protects the
contractor as much as the company.

**"Can I approve a re-clean outside 48 hours?"**
Yes — the badge tells you it's outside the window and leaves it to your discretion.

**"Approve is greyed out."**
Either you haven't classified it, or you've chosen full re-service without ticking the admin
approval box.

**"There are no photos on this job."**
Under 14 days old, that means the crew didn't upload any — a real problem, and grounds for a
coaching conversation. Over 14 days, check the Drive folder.

**"Does a re-clean cost the contractor money?"**
They're paid for the re-clean. What a quality-miss classification costs them is score, not
pay.
