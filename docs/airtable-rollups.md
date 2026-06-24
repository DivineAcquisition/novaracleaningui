# Airtable rollups — Contractors pay (manual, ~2 min)

Airtable **rollup / formula / lookup** fields **cannot be created via the API**
(they're UI-only field types). Our sync already keeps live-ish totals on the
**Contractors** table (`Lifetime Pay`, `Pay This Month`, `Lifetime Jobs`,
refreshed every 6 hours and on each onboarding), and it links each contractor to
their **Payroll Runs**. If you want true *native, always-live* rollups that
recalculate the instant a payroll run changes, add them in the Airtable UI:

Base: **NVC | Client & Revenue Ops** → table **Contractors**.

For each rollup: **+ Add field → Rollup**, then:

| Field name        | Linked field   | Field to roll up (Payroll Runs) | Aggregation |
| ----------------- | -------------- | ------------------------------- | ----------- |
| Net Pay (live)    | `Payroll Runs` | `Net Pay`                       | `SUM(values)` |
| Gross Pay (live)  | `Payroll Runs` | `Gross Pay`                     | `SUM(values)` |
| Payroll Jobs      | `Payroll Runs` | `Total Jobs`                    | `SUM(values)` |
| Last Paid         | `Payroll Runs` | `Period End`                    | `MAX(values)` |

Steps for each:
1. Click **+** to the right of the last column → **Rollup**.
2. **Link to records in** → choose **Payroll Runs**.
3. **Roll up field** → pick the Payroll Runs field from the table above.
4. **Aggregation function** → enter the formula in the table (e.g. `SUM(values)`).
5. (Optional) set Formatting → Currency / Number, name the field, **Create field**.

The same pattern works on the **Clients** table for STR host revenue if you link
Jobs → Clients and roll up `Customer Paid`.

> Note: the computed columns our sync writes (`Lifetime Pay`, etc.) and these
> native rollups can coexist — the rollups are live; the synced columns are a
> snapshot refreshed every 6h. Keep whichever you prefer.
