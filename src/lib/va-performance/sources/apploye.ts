// ─── Apploye collector — hours only ───────────────────────────────────────────
//
// The only metric this source contributes is hours_tracked. That is the entire
// scope of the Apploye integration, by design (see src/lib/apploye/client.ts).
// No activity percentage, screenshot, keystroke or app-usage value is read,
// stored or displayed anywhere in this system.
//
// A VA with no linked Apploye user id resolves to `unlinked`, not zero: we
// genuinely don't know their hours, and showing 0.00 h would be a lie that
// happens to look like an accusation.

import { hoursByUserForDate, isApployeConfigured, ApployeNotConfiguredError } from "@/lib/apploye/client";
import type { MetricKey, SourceStatus } from "../metrics";
import { notConfigured, ok, setValue, unavailable, type Collector, type CollectorResult } from "./types";

export const apployeCollector: Collector = {
  source: "apploye",
  metrics: ["hours_tracked"] as MetricKey[],

  async collect(ctx): Promise<CollectorResult> {
    const byVa = new Map<string, Record<string, number | null>>();
    const vaStatus = new Map<string, SourceStatus>();

    if (!isApployeConfigured()) {
      return { byVa, status: notConfigured("APPLOYE_API_KEY is not set.") };
    }

    let hours: Map<string, number>;
    try {
      hours = await hoursByUserForDate(ctx.date);
    } catch (err) {
      if (err instanceof ApployeNotConfiguredError) {
        return { byVa, status: notConfigured(err.message) };
      }
      return { byVa, status: unavailable(err) };
    }

    for (const va of ctx.vas) {
      if (!va.apployeUserId) {
        vaStatus.set(va.id, "unlinked");
        continue;
      }
      // The source WAS reached, so a member with no entry genuinely tracked
      // nothing today — 0.00 is a real answer here, not a missing one.
      setValue(byVa, va.id, "hours_tracked", hours.get(va.apployeUserId) ?? 0);
    }

    return { byVa, status: ok(), vaStatus };
  },
};
