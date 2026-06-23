# Cursor Build Spec — Airtable Schema Finish + Data Mapping (NovaraCleaning)

> Original build spec. For the implemented integration, setup, run order, and the
> GHL-alignment map, see [`docs/airtable-revenue-ops.md`](./airtable-revenue-ops.md).

The base and all data fields already exist (built via API). This spec covers two jobs:
**(A) finish the schema** by adding the link fields the no-code build couldn't create, and
**(B) build the integration** that maps live data (bookings, jobs, payments) into Airtable.

---

## 0. Context

- **Stack:** Next.js 14 + Supabase (deployed Vercel), Stripe for payments.
- **Airtable Personal Access Token (PAT) stored in:** env var `AIRTABLE_PAT`
  (scopes: `schema.bases:write`, `data.records:read`, `data.records:write`).
- **Where booking/job data originates:** the partner-portal Supabase DB
  (`customers`, `bookings`, `jobs`, `job_assignments`, `cleaners`, `payouts`).

**Rules:** Use the Airtable Web API (REST) + Meta API. Never hard-code the PAT.
All writes idempotent. Test against the real IDs below.

---

## 1. Target Base — Real IDs (already created)

**Base: `NVC | Client & Revenue Ops`** — `baseId: appoUuFQZQfCyKGlw`

| Table | Table ID | Primary Field |
|---|---|---|
| Clients | `tblVdeArr2xi6X8nV` | Client Name (`fld80wgt9XE4q75FN`) |
| Jobs | `tblAPqJV5Zb7EY6OR` | Job ID (`fld9aWli13kTxoMzf`) |
| Properties | `tblb9GXgPjNKaUogN` | Property Nickname (`fld6CkyqjKFN9VIxB`) |
| Commercial Accounts | `tblv37oMyC0hF6Yav` | Business Name (`fldVuD4wKWQ0TL0Ss`) |
| Sites | `tblIAnpKS2RKtYPZk` | Site Nickname (`fldC0rBkpvhLCISWI`) |
| Payroll Runs | `tblGr8Cu8avwvV3xy` | Run ID (`fldma9MP4dAavHr1w`) |

Field IDs for every table are encoded in `src/lib/airtable/schema.ts`.

---

## 2. Job A — Add the Missing Link Fields (Airtable Meta API)

Create 6 `multipleRecordLinks` fields via
`POST https://api.airtable.com/v0/meta/bases/appoUuFQZQfCyKGlw/tables/{tableId}/fields`
(Airtable auto-creates the symmetric reverse field):

1. Jobs → Clients — "Client"
2. Properties → Clients — "Host"
3. Commercial Accounts → Clients — "Decision Maker"
4. Sites → Commercial Accounts — "Commercial Account"
5. Jobs → Payroll Runs — "Payroll Run"
6. Jobs → Properties — "Property" (STR turnovers)

Implemented by `scripts/add-airtable-links.ts` (idempotent — checks by name first).

---

## 3. Job B — The Data Mapping Layer

- **Client:** `src/lib/airtable/client.ts` — PAT from env, `upsertRecord` via
  `performUpsert.fieldsToMergeOn`, shared rate-limit queue (≤5 req/s/base),
  batch ≤10/request.
- **Mappers:** `src/lib/airtable/mappers/*` — `syncClient`, `syncProperty`,
  `syncCommercialAccount`, `syncSite`, `syncJob`, `syncPayrollRun`.
  `syncJob` computes the locked tier %, pool, per-cleaner pay, and pay period.
- **Triggers:** `src/app/api/airtable/sync/route.ts` (Supabase DB Webhooks / GHL /
  cron) + `src/lib/airtable/sync.ts` orchestration.
- **Select-field safety:** exact option names + `typecast:true`; unknown options
  are logged.

---

## 4–6. Guardrails / Build order / Verification

See [`docs/airtable-revenue-ops.md`](./airtable-revenue-ops.md). Verification is
automated in `scripts/verify-airtable-mapping.ts` (`npm run airtable:verify`),
including: Foundation $239 → $83.65 pool → $41.83 per cleaner (two cleaners).
