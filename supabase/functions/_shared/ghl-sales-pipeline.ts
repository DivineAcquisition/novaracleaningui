// ─── Sales pipeline opportunity sync (parallel to Job Dispatch) ────────────
//
// Keeps the Sales Pipeline card in sync when bookings are created/updated
// without moving that card onto the Job Dispatch pipeline.

import { ghlIsConfigured, updateOpportunity, findOpportunityForContactInPipeline } from "./ghl-client.ts";

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> };
    };
  };
};

async function resolveSecret(
  supabase: SupabaseLike,
  key: string,
): Promise<string> {
  try {
    const { data } = await supabase
      .from("app_secrets")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return (data?.value as string) || (Deno.env.get(key) || "").trim();
  } catch {
    return (Deno.env.get(key) || "").trim();
  }
}

const NON_SALES_PIPELINE_RE =
  /\b(hir|recruit|cleaner|team|onboard|driver|contractor|applicant|interview|dispatch|job)\b/i;

export interface SyncSalesPipelineArgs {
  booking: Record<string, unknown>;
  leadId?: string | null;
  monetaryValue?: number;
}

/**
 * Update (or resolve) the Sales Pipeline opportunity for a booking.
 * Never throws.
 */
export async function syncBookingSalesPipeline(
  supabase: SupabaseLike,
  args: SyncSalesPipelineArgs,
): Promise<{ salesOpportunityId: string | null; updated: boolean }> {
  
  if (!ghlIsConfigured()) return { salesOpportunityId: null, updated: false };

  let salesOppId = (args.booking.ghl_sales_opportunity_id as string | null) || null;
  const contactId = (args.booking.ghl_contact_id as string | null) || null;

  if (!salesOppId && args.leadId) {
    try {
      const { data: lead } = await supabase
        .from("leads")
        .select("ghl_opportunity_id")
        .eq("id", String(args.leadId))
        .maybeSingle();
      salesOppId = (lead?.ghl_opportunity_id as string) || null;
    } catch {
      /* ignore */
    }
  }

  let pipelineId = await resolveSecret(supabase, "GHL_SALES_PIPELINE_ID");
  if (!pipelineId) {
    pipelineId = (Deno.env.get("GHL_PIPELINE_ID") || "").trim();
  }

  if (!salesOppId && contactId && pipelineId) {
    const found = await findOpportunityForContactInPipeline(contactId, pipelineId);
    if (found?.id) salesOppId = found.id;
  }

  if (!salesOppId) {
    return { salesOpportunityId: null, updated: false };
  }

  const statusRaw = String(args.booking.status || "").toLowerCase();
  let status: "open" | "won" | "lost" | "abandoned" = "open";
  if (statusRaw === "completed") status = "won";
  else if (statusRaw === "cancelled") status = "lost";

  const name = `Novara Booking — ${args.booking.first_name || ""} ${args.booking.last_name || ""}`
    .trim();
  const monetaryValue = args.monetaryValue ??
    Math.round(Number(args.booking.total_estimate_cents || 0) / 100);

  const ok = await updateOpportunity(salesOppId, {
    name,
    status,
    monetaryValue,
  });

  return { salesOpportunityId: salesOppId, updated: ok };
}

/** True when a pipeline name looks like Sales (not hiring/dispatch). */
export function isLikelySalesPipelineName(name: string): boolean {
  return Boolean(name) && !NON_SALES_PIPELINE_RE.test(name);
}
