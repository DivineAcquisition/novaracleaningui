# Live screens for X

The real app, one card per area of the platform breakdown. Each pairs with the diagram card of
the same number in `../` — post the diagram, then the live card, so the thread goes
*here's how it works* → *here it is running*. 1600×900 (X's in-feed size), rendered at 2×.

Every screen is the real component from this repo. **The data is invented**: names, addresses,
amounts and photos come from `scripts/marketing/live-screens-data.ts` and
`scripts/docs/capture/demo-data.ts`, and the production database is never contacted. Each card
says "Real screens · demo data" in the corner; keep that line if you crop.

| Card | Follows | Draft post |
| --- | --- | --- |
| `01-customer-booking.png` | `../01-customer-booking.png` | What the customer actually sees: ZIP → home size → an exact price with the deposit due today. Three screens, no phone call. |
| `02-pricing-engine.png` | `../02-pricing-engine.png` | Here's the engine in the app. Type a ZIP on the booking desk and the quote rebuilds itself: base rate, condition, zone, demand, each on its own line. |
| `03-recurring-revenue.png` | `../03-recurring-revenue.png` | Members get a link by text to skip, reschedule or pause on their own. We get one screen with MRR, lifetime value and who's at risk. |
| `04-speed-to-lead.png` | `../04-speed-to-lead.png` | Leads arrive scored and tagged by source: Facebook, Google, the website. Our VAs pull them up on the booking desk and quote them live. |
| `05-dispatch.png` | `../05-dispatch.png` | Dispatch, live: the board on the left, the text a cleaner opens on the right. One approval, then the first to accept gets the job. |
| `06-quality-control.png` | `../06-quality-control.png` | When something goes wrong, nobody digs through old texts. The case file pulls the agreement, the Stripe payments, the photos and the checklist on its own. |
| `07-back-office.png` | `../07-back-office.png` | Payroll starts from the finished job. Pay is suggested from the job's value and the cleaner's rate, and our margin sits right next to it. |
| `08-other-channels.png` | `../08-other-channels.png` | Same rails, different front doors: Airbnb hosts get a portal for their turnovers, offices get a proposal priced from the walkthrough. |

## Raw screens

Unframed captures (desktop 2880 px wide, phone 860 px) for your own layouts or replies.

| File | Device | What it shows |
| --- | --- | --- |
| `screens/booking-zip.png` | phone | Customer booking, step 1: ZIP code. |
| `screens/booking-size.png` | phone | Customer booking, step 2: home size. |
| `screens/booking-price.png` | phone | Customer booking, step 3: an exact price for this home, deposit due today. |
| `screens/booking-desk-quote.png` | desktop | The booking desk's live quote: base rate, condition, zone and demand, each on its own line. |
| `screens/recurring-manage.png` | phone | The self-serve link members get by text: next visit, upcoming dates, skip, reschedule or pause. |
| `screens/memberships-hub.png` | desktop | Memberships hub: MRR, ARR, lifetime value, at-risk members and each member's regular cleaner. |
| `screens/booking-desk-lead.png` | desktop | The booking desk: a VA pulls up a new Facebook lead, scored hot, and books it from here. |
| `screens/dispatch-board.png` | desktop | Dispatch board: jobs waiting for approval, offers out, crews confirmed and a live checklist. |
| `screens/job-offer.png` | phone | The offer a cleaner opens from the text: pay, time, place, accept or decline. |
| `screens/qc-issues.png` | desktop | Quality control: every complaint is a case with a severity, a status and its re-clean. |
| `screens/qc-documentation.png` | desktop | Job documentation: every finished job's photos and checklist, archived to Drive with a dispute packet. |
| `screens/qc-case-file.png` | desktop | A live case file: signed agreement, Stripe payments, before/after photos, checklist and the dispute packet. |
| `screens/payroll.png` | desktop | Payroll: pick a finished job and the crew's pay is suggested from the job value and their rate. |
| `screens/host-portal.png` | phone | The host portal: properties, upcoming turnovers and the card on file. |
| `screens/commercial-proposal.png` | desktop | A commercial proposal: per-site pricing from the walkthrough, monthly estimate and terms. |

## Before you post a raw screen

The cards are cropped around three things on the real screens that you may not want public.
If you post a raw screen instead, check these first:

- `screens/booking-price.png` — the bottom edge shows the next card's "25% off" badge. On the
  live site that label sits on the Deep + Standard combo, which is 20% off its list price (and
  the Standard card says 25% while applying 15%). The card crops at the Deep Clean card, whose
  25% is right.
- `screens/dispatch-board.png` — the two header switches render half-styled (the HeroUI theme
  package isn't in Tailwind's scan path in this install). The card starts below them.
- `screens/payroll.png` — the page's own header says Stripe transfers for job payouts are
  paused. The card starts at the totals row.

## Regenerating

```bash
npm run dev -- --port 3100                          # in one terminal
npx tsx scripts/marketing/live-screens.ts           # capture + cards
npx tsx scripts/marketing/live-screens.ts --cards   # cards only, from the saved screens
```

Set `DOCS_CAPTURE_FONT_DIR` to a folder with the @fontsource Inter, Plus Jakarta Sans and JetBrains
Mono files when Google Fonts can't be reached, so the screens use the real brand fonts.
