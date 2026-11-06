// ─── Server: where Novara cleans ─────────────────────────────────────────────
//
// Counts active ZIP codes per state from service_coverage_zones, the same
// table the booking flow checks a ZIP against. SERVER ONLY. Cached for an hour.

import { unstable_cache } from "next/cache";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export type CoverageState = { state: "MD" | "DC" | "VA"; zips: number };

const STATES: CoverageState["state"][] = ["MD", "DC", "VA"];

async function loadCoverageUncached(): Promise<CoverageState[] | null> {
  try {
    const supabase = getAdminSupabase();
    const counts = await Promise.all(
      STATES.map((state) =>
        supabase
          .from("service_coverage_zones")
          .select("zip_code", { count: "exact", head: true })
          .eq("is_active", true)
          .eq("state", state),
      ),
    );
    const rows = STATES.map((state, i) => ({ state, zips: counts[i].count || 0 }));
    return rows.some((r) => r.zips > 0) ? rows : null;
  } catch (err) {
    console.error("[landing] coverage unavailable:", err);
    return null;
  }
}

export const getCoverage = unstable_cache(loadCoverageUncached, ["landing-coverage-v1"], {
  revalidate: 3600,
  tags: ["landing-data"],
});
