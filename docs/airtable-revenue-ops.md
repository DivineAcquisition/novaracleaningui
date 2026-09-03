# Airtable — "NVC | Client & Revenue Ops" integration

Maps live Novara data (clients, jobs, payroll) into the Airtable base
`appoUuFQZQfCyKGlw` and finishes the base schema by adding the cross-table link
fields the no-code build couldn't create.

- **Stack:** Next.js 14 + Supabase (partner-portal DB is the source of record) + Stripe.
- **Source of booking/job/payment data:** the Supabase database (`customers`,
  `bookings`, `jobs`, `job_assignments`, `cleaners`, `manual_payouts`).
- **Clients table:** only people who **finished a booking** (`bookings.status =
  completed`), plus STR hosts needed for Properties links. Leads / quotes /
  abandoned carts are not Clients.
- **Payroll Runs table:** only **Custom Payroll** (`manual_payouts`). Extra-pay
  rows do not create or inflate payroll runs.
- **Transport:** Airtable Web API (REST) + Meta API. The PAT is read server-side
  from `AIRTABLE_PAT` and is never hard-coded or logged.

## Layout

| Path | Purpose |
|---|---|
| `src/lib/airtable/schema.ts` | Base / table / field IDs, select vocabularies, the 6 link-field specs, and the GHL-alignment map. |
| `src/lib/airtable/client.ts` | Typed REST + Meta client: shared rate-limit queue (≤5 req/s/base), batched upsert (≤10/req) via `performUpsert.fieldsToMergeOn`, 429/5xx retry with backoff, `typecast` + unknown-option logging. |
| `src/lib/airtable/pay.ts` | Locked job-pay math (tier %, pool, per-cleaner) + pay-period helpers. |
| `src/lib/airtable/mappers/*` | One mapper per entity (`syncClient`, `syncProperty`, `syncCommercialAccount`, `syncSite`, `syncJob`, `syncPayrollRun`). |
| `src/lib/airtable/sources/*` | Supabase row → mapper-input adapters + service-role client. |
| `src/lib/airtable/sync.ts` | Fetch-from-Supabase → map → upsert orchestration. |
| `src/app/api/airtable/sync/route.ts` | Webhook trigger endpoint (Supabase DB Webhooks / GHL / cron). |
| `scripts/add-airtable-links.ts` | Job A — create the 6 link fields (idempotent). |
| `scripts/backfill-airtable.ts` | Push existing source rows into Airtable once. |
| `scripts/verify-airtable-mapping.ts` | Offline checks for the pay math + idempotency. |

## Environment

```
AIRTABLE_PAT=pat...            # scopes: schema.bases:write, data.records:read, data.records:write
# optional override (defaults to appoUuFQZQfCyKGlw):
AIRTABLE_REVENUE_OPS_BASE_ID=appoUuFQZQfCyKGlw
# for the webhook route + backfill (service role bypasses RLS):
SUPABASE_URL=...               # or NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=...
AIRTABLE_SYNC_WEBHOOK_SECRET=...  # shared secret the /api/airtable/sync route requires
```

> The legacy `_shared/airtable.ts` edge-function mirror writes to a *different*,
> simpler base and is left untouched. This integration targets the new
> Client & Revenue Ops base by field ID.

## Run order

```bash
npm run airtable:verify     # offline sanity check (no PAT needed)
npm run airtable:links      # Job A — create the 6 link fields (run once; safe to repeat)
npm run airtable:backfill   # seed existing clients/jobs/payroll (idempotent)
```

Backfill a single entity: `npm run airtable:backfill -- clients` (or `jobs`, `payroll`).

## Link fields created (Job A)

All `multipleRecordLinks`; Airtable auto-creates the symmetric reverse field.

1. Jobs → Clients (**Client**)
2. Properties → Clients (**Host**)
3. Commercial Accounts → Clients (**Decision Maker**)
4. Sites → Commercial Accounts (**Commercial Account**)
5. Jobs → Payroll Runs (**Payroll Run**)
6. Jobs → Properties (**Property**, for STR turnovers)

## Trigger points

Wire the webhook route from whichever trigger fits the source:

- **Supabase Database Webhooks** (recommended) on `customers`, `bookings`,
  `payouts` → `POST /api/airtable/sync` with header
  `x-airtable-sync-secret: <AIRTABLE_SYNC_WEBHOOK_SECRET>`. The route accepts the
  native Supabase webhook shape (`{ table, record, type }`).
- **GHL / external automation** → same endpoint with `{ "type": "job", "id": "<booking uuid>" }`.
- **Cron / scheduled** → re-run `npm run airtable:backfill`.

Mapping by event:

| Source event | Sync |
|---|---|
| client created/updated | `syncClient` (only if they finished a booking or are an STR host) |
| property/account/site created/updated | `syncProperty` / `syncCommercialAccount` / `syncSite` |
| **job completed** (high-frequency) | `syncJob` (upsert on Job ID; pay from `manual_payouts`) |
| payroll run created/paid | `syncPayrollRun` from Custom Payroll only (upsert on Run ID) |

## Locked pay math

```
tier_pct_locked   = cleaner tier at completion (Foundation 35 / Proven 40 / Elite 45)
cleaner_pay_pool  = customer_paid × tier_pct_locked
pay_per_cleaner   = cleaner_pay_pool ÷ number_of_cleaners   (nearest cent)
pay_period        = Monday of the week of date_completed
```

Worked example (verified by `airtable:verify`): Foundation, **$239** →
pool **$83.65** → two cleaners → **$41.83** each. Money is computed in code and
Airtable stores the locked result (no Airtable formulas). When the Supabase
payout engine has already computed the authoritative cents, pass them into
`syncJob` (`cleanerPayPoolCents` / `payPerCleanerCents`) and they win.

## Crucial data shared with GHL

This base mirrors the same operational truth the GHL contact sync
(`supabase/functions/_shared/ghl-field-map.ts`) pushes, so the CRM and the
revenue-ops base never drift. `CRUCIAL_GHL_FIELDS` in `schema.ts` is the audit
map; keep these aligned when either side changes:

| Crucial datum | Airtable field | GHL field key |
|---|---|---|
| Lead source | Clients · Lead Source | `lead_source` |
| Lifecycle / membership stage | Clients · Lifecycle Stage | `membership_status` |
| Service zone / market | Clients · Service Zone | `market` |
| Stripe customer id | Clients · Stripe Customer ID | `stripe_customer_id` |
| Payment method on file | Clients · Payment Method on File | `default_payment_method` |
| SMS opt-in | Clients · SMS Opt-In | `sms_opt_in` |
| Job payment status | Jobs · Payment Status | `payment_status` |
| Locked pay tier | Jobs · Tier % Locked | `assigned_cleaner_pay_tier` |
| Cleaner pay pool | Jobs · Cleaner Pay Pool | contractor pay (pool) |
| Pay per cleaner | Jobs · Pay Per Cleaner | `1_contractor_pay` |
| Cleaner name | Jobs · Cleaner (Name) | `1_contractor` |

## Guardrails honoured

- PAT server-side only, read from env at call time, never logged.
- Every write is an upsert on a natural key (Email / Job ID / Run ID / Nickname) —
  re-running never duplicates.
- Money math computed in code; Airtable holds the locked result.
- Shared queue paces requests under 5 req/s/base; batches ≤10 records/request.
- The Contractors table is in a separate base (`app0jCdQHXOvItVPo`) — the cleaner
  is stored as the text field **Cleaner (Name)** and matched by name; no cross-base link.
- Every Airtable call is wrapped in try/catch with 429 retry (honours `Retry-After`).
- `singleSelect`/`multipleSelects` writes send exact option names with `typecast:true`;
  values outside the known vocabulary are logged for review.
