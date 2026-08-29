---
title: Weekly Report
area: Reports
category: How the Tool Works
summary: The weekly sales, retention and growth PDF — when it runs, how to generate one, and the ad-spend log.
whoCanSee: Full admins only
where: /admin/weekly-report
lastVerified: 2026-08-29
order: 16
---

The weekly report is a generated PDF covering sales, retention and growth. It runs on a
schedule, emails whoever is on the list, and files a copy in Drive. Admin-only.

@screenshot weekly-report

## Generating one

**Generate last week** produces the report for the week just gone — the button to use when
someone asks for it before it has run, or when a scheduled run failed.

**On-demand custom range** produces one for any dates you choose. Monday to Sunday is
recommended, because the comparisons in the report assume whole weeks; a partial week
produces a technically correct report that reads as though something collapsed.

## The schedule

**Schedule** opens the settings: which weekday it runs, what hour, whether it's enabled at
all, and the comma-separated list of email recipients. It also shows which Drive folder the
copies land in.

Check the recipient list when someone joins or leaves — a report emailing a departed
colleague is both a gap and a small data-protection problem.

## Reading the list

Each row is a report: the period it covers, a status badge — **generated**, **failed**, or
**drive pending** — how it was triggered, and a one-line summary.

Expand a row for **Open PDF**, the **Drive copy**, the headline numbers (booked, collected,
bookings), the insights, and — importantly — any **unavailable sources**.

:::warning Check the unavailable-sources line before circulating a report
If a data source was unreachable when the report ran, the report still generates, and the
affected numbers will be missing or low.

Reading a bad week off a report that couldn't reach Stripe is an easy mistake to make in a
meeting. The expanded row tells you. Look before you send it on.
:::

A **failed** status means no PDF. Re-run it with **Generate last week** or a custom range.

## The monthly ad-spend log

Two buttons: **Email last month** and **Email every month since launch**. These send the
tokenised ad-spend log — a no-login page where monthly ad spend is recorded, which then feeds
the return-on-spend figures.

Use the catch-up button sparingly; it emails one link per month since launch.

## Common questions

**"The report didn't arrive Monday."**
Check the schedule is enabled and the weekday and hour are right, then look for a **failed**
row. **Generate last week** produces it now.

**"The numbers look wrong."**
Expand the row and check unavailable sources first. That explains most of it.

**"Can I get a report for a specific fortnight?"**
Yes, with a custom range — but the week-on-week comparisons assume whole weeks, so read them
with that in mind.

**"Where do the copies live?"**
Drive, in the folder named in the schedule panel, alongside the PDF link on each row.
