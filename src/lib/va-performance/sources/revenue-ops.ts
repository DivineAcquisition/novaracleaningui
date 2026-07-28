// ─── Client & Revenue Ops collector — bookings, revenue, commercial ───────────
//
// These numbers are read from the workspace tables (bookings, business_accounts)
// rather than by querying the Airtable Jobs / Commercial Accounts tables
// directly. They are the same records: the existing Airtable pipeline mirrors
// every one of these rows into the Client & Revenue Ops base. Reading the
// workspace side gives us the VA attribution that the mirrored Airtable rows
// don't carry, and avoids burning the base's API quota once per VA per day.
//
// Attribution follows the conventions the booking paths already write:
//   bookings.sdr_rep_name  — the VA's name on a book-as-va booking
//   bookings.booker_source — "va_{name}" / "va_admin" / "va_book"
//   business_accounts.created_by — the VA's workspace user id

import type { MetricKey, SourceStatus } from "../metrics";
import { nameAliases, type VaRecord } from "../vas";
import {
  bump,
  ok,
  setValue,
  unavailable,
  type Collector,
  type CollectContext,
  type CollectorResult,
} from "./types";

const METRICS: MetricKey[] = [
  "bookings_created",
  "jobs_completed",
  "revenue_booked_cents",
  "commercial_accounts_touched",
  "walkthroughs_booked",
];

/** Statuses that mean the booking never became real work. */
const VOID_STATUSES = new Set(["abandoned", "pending_payment"]);

const COMMERCIAL_TYPES = new Set(["commercial", "office", "business"]);

/** Build a lookup from every free-text name a VA might have been recorded as. */
function aliasIndex(vas: VaRecord[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const va of vas) {
    for (const alias of nameAliases(va)) {
      // First writer wins so a shared first name can't silently steal
      // another VA's bookings; ambiguity resolves to whoever onboarded first.
      if (!index.has(alias)) index.set(alias, va.id);
    }
  }
  return index;
}

function matchVa(index: Map<string, string>, ...candidates: (string | null | undefined)[]): string | null {
  for (const raw of candidates) {
    const value = (raw || "").trim().toLowerCase();
    if (!value) continue;
    const direct = index.get(value);
    if (direct) return direct;
    // booker_source is written as "va_{name}" by the internal booking flow.
    if (value.startsWith("va_")) {
      const stripped = index.get(value.slice(3));
      if (stripped) return stripped;
    }
  }
  return null;
}

export const revenueOpsCollector: Collector = {
  source: "airtableRevenueOps",
  metrics: METRICS,

  async collect(ctx: CollectContext): Promise<CollectorResult> {
    const byVa = new Map<string, Record<string, number | null>>();
    const vaStatus = new Map<string, SourceStatus>();
    const index = aliasIndex(ctx.vas);

    const [bookings, completed, accounts] = await Promise.all([
      ctx.supabase
        .from("bookings")
        .select(
          "id, created_at, status, sdr_rep_name, booker_source, booking_channel, " +
            "total_estimate_cents, final_charge_cents, booking_type, business_account_id",
        )
        .gte("created_at", ctx.window.startIso)
        .lt("created_at", ctx.window.endIso),
      // Jobs finished today. Attribution doesn't apply — the cleaner completes
      // the job — so this is the company-wide count, which is exactly what the
      // VA is reporting when they answer "jobs completed".
      ctx.supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("updated_at", ctx.window.startIso)
        .lt("updated_at", ctx.window.endIso),
      ctx.supabase
        .from("business_accounts")
        .select("id, created_by, created_at, last_activity_at")
        // Created OR touched inside the window. Timestamps are quoted so
        // PostgREST treats them as literal values.
        .or(
          `and(created_at.gte."${ctx.window.startIso}",created_at.lt."${ctx.window.endIso}"),` +
            `and(last_activity_at.gte."${ctx.window.startIso}",last_activity_at.lt."${ctx.window.endIso}")`,
        ),
    ]);

    if (bookings.error) return { byVa, status: unavailable(bookings.error.message) };

    // Source reached: every VA starts at a real zero.
    for (const va of ctx.vas) {
      for (const key of METRICS) setValue(byVa, va.id, key, 0);
    }

    for (const row of ((bookings.data || []) as unknown as Record<string, unknown>[])) {
      if (VOID_STATUSES.has(String(row.status || "").toLowerCase())) continue;
      const vaId = matchVa(
        index,
        row.sdr_rep_name as string,
        row.booker_source as string,
      );
      if (!vaId) continue;

      bump(byVa, vaId, "bookings_created", 1);
      const cents = Number(row.final_charge_cents ?? row.total_estimate_cents ?? 0);
      if (Number.isFinite(cents)) bump(byVa, vaId, "revenue_booked_cents", cents);

      const isCommercial =
        Boolean(row.business_account_id) ||
        COMMERCIAL_TYPES.has(String(row.booking_type || "").toLowerCase());
      if (isCommercial) bump(byVa, vaId, "walkthroughs_booked", 1);
    }

    const completedCount = completed.error ? null : (completed.count ?? 0);
    for (const va of ctx.vas) setValue(byVa, va.id, "jobs_completed", completedCount);

    if (!accounts.error) {
      const byUser = new Map<string, string>();
      for (const va of ctx.vas) if (va.workspaceUserId) byUser.set(va.workspaceUserId, va.id);
      for (const row of ((accounts.data || []) as unknown as Record<string, unknown>[])) {
        const vaId = row.created_by ? byUser.get(String(row.created_by)) : undefined;
        if (vaId) bump(byVa, vaId, "commercial_accounts_touched", 1);
      }
    } else {
      // Bookings survived, commercial didn't — say so per metric rather than
      // failing the whole source.
      for (const va of ctx.vas) setValue(byVa, va.id, "commercial_accounts_touched", null);
    }

    return {
      byVa,
      status: ok(),
      vaStatus,
      metricStatus: {
        ...(accounts.error ? { commercial_accounts_touched: "unavailable" as SourceStatus } : {}),
        ...(completed.error ? { jobs_completed: "unavailable" as SourceStatus } : {}),
      },
    };
  },
};
