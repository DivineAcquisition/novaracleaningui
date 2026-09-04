import type { SupabaseClient } from "@supabase/supabase-js";

const LOOKBACK_DAYS = 28;

export type PulseEarningsSnapshot = {
  avgWeeklyPayCents: number | null;
  lookbackDays: number;
  paidContractorCount: number;
  totalPaidCents: number;
};

function dollarsFromCents(cents: number): string {
  return (Math.round(cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function formatAvgWeeklyPay(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) {
    return "Active contractors get paid per job, usually within 24 hours.";
  }
  return `Active Novara contractors who were paid in the last 4 weeks averaged about ${dollarsFromCents(cents)} a week.`;
}

/**
 * Mean weekly pay among contractors who actually received a payout in the window.
 * total paid / distinct paid contractors / (days/7).
 */
export async function loadAverageWeeklyContractorPay(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<PulseEarningsSnapshot> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await (supabase.from as any)("manual_payouts")
    .select("cleaner_id, amount_cents, status, paid_at, created_at")
    .eq("status", "paid")
    .gte("created_at", since)
    .limit(5000);
  if (error || !Array.isArray(data) || data.length === 0) {
    return { avgWeeklyPayCents: null, lookbackDays: LOOKBACK_DAYS, paidContractorCount: 0, totalPaidCents: 0 };
  }

  const byCleaner = new Map<string, number>();
  let total = 0;
  for (const row of data) {
    const id = String(row.cleaner_id || "").trim();
    if (!id) continue;
    const cents = Math.max(0, Number(row.amount_cents) || 0);
    total += cents;
    byCleaner.set(id, (byCleaner.get(id) || 0) + cents);
  }
  const n = byCleaner.size;
  const weeks = LOOKBACK_DAYS / 7;
  const avg = n > 0 ? total / n / weeks : null;
  return {
    avgWeeklyPayCents: avg != null && Number.isFinite(avg) ? Math.round(avg) : null,
    lookbackDays: LOOKBACK_DAYS,
    paidContractorCount: n,
    totalPaidCents: total,
  };
}
