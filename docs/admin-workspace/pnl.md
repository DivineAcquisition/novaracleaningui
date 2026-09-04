---
title: Profit & Loss
area: Reports
category: How the Tool Works
summary: Collected vs pipeline revenue, ad spend, contribution and ROAS — the money picture that used to live only in the Google Sheet.
whoCanSee: Full admins only
where: /admin/pnl
lastVerified: 2026-09-04
order: 17
---

P&L is admin-only. VAs who open it get **"Admins only — this section is restricted to
admins"** and are sent back to the dashboard.

It is the live money picture. The branded Google Sheet is a **mirror** of these numbers, not
the source of truth. Supabase is.

## What the tiles mean

**Collected** is completed jobs in the selected month. The job's final charge is used when it
exists, otherwise the estimate. Re-cleans are **$0** — the Spotless Guarantee job is not
revenue.

**Pipeline** is jobs that are confirmed, assigned, awaiting payment, or awaiting details.
They are on the calendar and they count toward booked ROAS, but they are not collected yet.
Facebook jobs that are booked and not finished live here.

**Job profit** is collected revenue minus cleaner pay minus extra pay (surge, overtime,
supplies paid through Extra Pay). Cleaner pay prefers the payroll ledger; if there is no
ledger row it uses the tier estimate on the booking. Pipeline jobs do not take a profit
figure until they complete.

**Ad spend** is what has been logged in the ad-spend table for that month. Months with no row
are **$0**, not a guess.

**Contribution** is job profit minus ad spend minus **Paid** expenses. Promised and Approved
expenses show as owed and stay off this number until someone marks them Paid.

**Booked ROAS** is (collected + pipeline) ÷ ad spend. **Collected ROAS** underneath is
collected only. When spend is $0 the tile shows a dash, not infinity.

Pick a **Month** (or **All months**) to change every tile and both tables. Click a row in
**By month** to jump to that month.

## Jobs and ads

The jobs table is that month's collected and pipeline rows. A **pipeline** badge means the
job is booked and not done. Profit is blank until it completes.

Ad spend lists each logged platform row, with that month's booked ROAS repeated on the line.

## Expenses

The same Promised → Paid workflow that used to sit on a retired P&L Data screen. Log as
**Promised** when you commit to it (owed, does not hit contribution). Flip to **Paid** when
the money has actually moved.

## The Google Sheet

**Open Google Sheet** is the branded workbook. It is overwritten by a daily sync (and by
**Sync sheet** on this page). Do not treat handwritten sheet cells in the Daily Log, Expenses,
Ad Spend, or EOD tabs as durable — the next sync replaces those ranges.

Month Tag and Job Profit are written as values (`2026-09`, not a date formula) so empty rows
cannot display **1899-12**.

Pipeline jobs do **not** appear on the sheet's Daily Log. The sheet is completed jobs only.
They appear here, under Pipeline, until they finish.

:::note The dashboard is not this screen
The dashboard is today's operations. A quiet today can look empty even when the month is
busy. P&L is the month. Use both.
:::
