// ─── Server: live data for the public marketing pages ───────────────────────
//
// Prices come from the booking flow's own tables (see prices.ts). Proof
// numbers are counted from completed jobs and post-visit ratings and only
// shown once they clear LANDING_PROOF_THRESHOLDS.
//
// SERVER ONLY. Uses the service-role client. Cached for an hour.

import { unstable_cache } from "next/cache";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { checkoutPrices, type LandingData, type LandingStats } from "./prices";

export * from "./prices";

type Json = Record<string, unknown>;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function loadStats(): Promise<LandingStats> {
  const supabase = getAdminSupabase();
  const [jobs, feedback] = await Promise.all([
    supabase.from("jobs").select("id", { count: "exact", head: true }).ilike("status", "complete%"),
    supabase.from("job_feedback").select("overall_rating").not("overall_rating", "is", null),
  ]);
  const ratings = (feedback.data || [])
    .map((r) => num((r as Json).overall_rating))
    .filter((n) => n > 0);
  const ratingAverage = ratings.length
    ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
    : null;
  return {
    completedCleans: jobs.count || 0,
    ratingCount: ratings.length,
    ratingAverage,
  };
}

async function loadLandingDataUncached(): Promise<LandingData> {
  const stats = await loadStats().catch((err) => {
    console.error("[landing] stats unavailable:", err);
    return null;
  });
  return { prices: checkoutPrices(), stats };
}

export const getLandingData = unstable_cache(loadLandingDataUncached, ["landing-data-v2"], {
  revalidate: 3600,
  tags: ["landing-data"],
});

