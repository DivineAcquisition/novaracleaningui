# Architecture cards for X

One image per area of the Novara platform breakdown, plus a cover and a by-the-numbers card.
Each is 1600×900 (X's in-feed size), rendered at 2× for sharp text. Post them in order as a thread.

Every node names the real edge function, table or route behind it. Regenerate with
`npx tsx scripts/marketing/architecture-cards.ts` after changing anything in that file.

| Image | Area | Draft post |
| --- | --- | --- |
| `00-cover.png` | Cover | We run a cleaning company on software we built ourselves. Here's the whole system, one piece at a time. 🧵 |
| `01-customer-booking.png` | Customer booking | Most cleaning companies still answer “how much?” with “we'll call you.” Ours answers with a number: ZIP → home size → exact price → deposit → booked. One flow, no phone tag. |
| `02-pricing-engine.png` | The pricing engine | Our pricing is a pipeline, not a guess: base rate × condition × zone × demand, clamped by a floor and a ceiling, then flat add-ons. Same inputs, same price, every time, and every layer shows as its own line. |
| `03-recurring-revenue.png` | Recurring revenue | The most valuable thing a cleaning company can build is a recurring customer. Members get their next visit booked automatically with the same cleaner, and an at-risk board flags quiet cancellations before they happen. |
| `04-speed-to-lead.png` | Speed-to-lead | Leads go cold in minutes. Ours don't get the chance: a cron checks every minute for leads nobody has called in 10 minutes and texts them, and an AI SMS agent can quote, find a slot and send a payment link on its own. |
| `05-dispatch.png` | Dispatch without a dispatcher | We don't have a dispatcher. Postgres owns the clock and the rules, edge functions send the texts: ranked cleaners get an SMS offer, first to claim wins, and unclaimed offers roll to the next closest automatically. |
| `06-quality-control.png` | Quality control | A complaint shouldn't be a he-said-she-said. Every one opens a case: a free re-clean under our Spotless Guarantee, plus a file built live from signed agreements, Stripe charges, photos, the checklist and a full audit trail. |
| `07-back-office.png` | Pay and paperwork | Paying 1099 cleaners usually means a spreadsheet and a late night. Ours: job approved → pay calculated from job value × tier → one Approve & Pay → Stripe Connect transfers → 1099-NEC built from the same ledger. |
| `08-other-channels.png` | Two more revenue lines, same rails | Once dispatch, checklists and payouts exist, a new revenue line is mostly a new front door. Airbnb turnovers land on the calendar and get dispatched like any job; commercial runs walkthrough → priced proposal → signed agreement. |
| `09-by-the-numbers.png` | By the numbers | All of it, by the numbers: 363k lines, 225 backend functions, 373 migrations, 118 pages, a contractor mobile app and 12 integrations. Built for one cleaning company. Running it today. |

## Where the numbers come from

Measured from this repository on the day the cards were made:

- **363k lines of code** — TypeScript and SQL tracked in git under `src`, `supabase`, `contractor-app`, `mobile` and `scripts`.
- **225 backend functions** — folders in `supabase/functions`, not counting `_shared`.
- **373 database migrations** — files in `supabase/migrations`.
- **118 web pages** — `page.tsx` files under `src/app`.
- **12 integrations** — services the edge functions call: Stripe Connect, GoHighLevel, Telnyx, Resend, Airtable, Google Calendar, Google Drive, DocuSeal, Discord, Zapier, Cal.com, Apploye.

The pricing card notes that the demand layer is built but switched off today; keep that
footnote if you crop the image.
