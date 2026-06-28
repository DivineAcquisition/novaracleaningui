// ─── Sales pipeline opportunity sync (parallel to Job Dispatch) ────────────
//
// Keeps the Sales Pipeline card in lockstep with a booking — for BOTH the
// customer funnel and internal VA bookings — without moving that card onto
// the Job Dispatch pipeline. Mirrors the full custom-field map onto the
// opportunity, assigns Malik as owner, adds the booking VA as a follower,
// and creates the card if one doesn't exist yet.

import {
  createOpportunity,
  findOpportunityForContactInPipeline,
  ghlIsConfigured,
  resolveOwnerUserId,
  resolveSalesStageForBooking,
  updateOpportunity,
} from "./ghl-client.ts";

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
  /** Full GHL custom-field map — mirrored onto the sales opportunity. */
  customFieldsByKey?: Record<string, string | number | boolean | null | undefined>;
  /** Opportunity owner (defaults to Malik via resolveOwnerUserId). */
  assignedTo?: string;
  /** GHL user ids to add as followers (e.g. the booking VA). */
  followers?: string[];
}

/**
 * Update (or create) the Sales Pipeline opportunity for a booking.
 * Never throws.
 */
export async function syncBookingSalesPipeline(
  supabase: SupabaseLike,
  args: SyncSalesPipelineArgs,
): Promise<{ salesOpportunityId: string | null; updated: boolean; created: boolean }> {
  if (!ghlIsConfigured()) {
    return { salesOpportunityId: null, updated: false, created: false };
  }

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

  const statusRaw = String(args.booking.status || "").toLowerCase();
  let status: "open" | "won" | "lost" | "abandoned" = "open";
  if (statusRaw === "completed") status = "won";
  else if (statusRaw === "cancelled") status = "lost";

  // Stage progression. Preference order:
  //   1. Explicit stage-id secrets (won / lost / booked) when configured.
  //   2. NAME-based resolution against the live Sales pipeline so the card
  //      advances through the WHOLE fulfillment cycle (booked → scheduled →
  //      in progress → won/paid) without anyone hand-entering stage UUIDs.
  const stageWon = await resolveSecret(supabase, "GHL_SALES_STAGE_WON");
  const stageLost = await resolveSecret(supabase, "GHL_SALES_STAGE_LOST");
  const stageBooked = await resolveSecret(supabase, "GHL_SALES_STAGE_BOOKED");
  let pipelineStageId: string | undefined;
  if (status === "won" && stageWon) pipelineStageId = stageWon;
  else if (status === "lost" && stageLost) pipelineStageId = stageLost;
  else if (status === "open" && stageBooked) pipelineStageId = stageBooked;

  // Name-based fulfillment-stage resolution (fills in the intermediate stages
  // the 3 secrets above can't express, and works with zero secret config).
  if (pipelineId) {
    try {
      const byName = await resolveSalesStageForBooking(pipelineId, {
        bookingStatus: args.booking.status as string | null,
        payoutStatus: args.booking.payout_status as string | null,
        cleanerId: args.booking.cleaner_id as string | null,
        serviceDate: args.booking.service_date as string | null,
      });
      if (byName) pipelineStageId = byName;
    } catch {
      /* leave stage unchanged on any resolution failure */
    }
  }

  const name =
    `Novara Booking — ${args.booking.first_name || ""} ${args.booking.last_name || ""}`
      .trim();
  const monetaryValue = args.monetaryValue ??
    Math.round(Number(args.booking.total_estimate_cents || 0) / 100);
  const assignedTo = args.assignedTo || (await resolveOwnerUserId()) || undefined;

  // No existing sales card — create one so EVERY booking lands in the sales
  // pipeline (customer-funnel bookings that never had a prior lead included).
  if (!salesOppId) {
    if (!contactId || !pipelineId) {
      return { salesOpportunityId: null, updated: false, created: false };
    }
    const createStage = await resolveSecret(supabase, "GHL_SALES_PIPELINE_STAGE_ID");
    const newId = await createOpportunity({
      contactId,
      pipelineId,
      pipelineStageId: pipelineStageId || createStage || undefined,
      name,
      status,
      monetaryValue,
      source: "Novara Booking",
      assignedTo,
      followers: args.followers,
      customFieldsByKey: args.customFieldsByKey,
    });
    return { salesOpportunityId: newId, updated: false, created: Boolean(newId) };
  }

  const ok = await updateOpportunity(salesOppId, {
    name,
    status,
    monetaryValue,
    pipelineStageId,
    assignedTo,
    followers: args.followers,
    customFieldsByKey: args.customFieldsByKey,
  });

  return { salesOpportunityId: salesOppId, updated: ok, created: false };
}

/** True when a pipeline name looks like Sales (not hiring/dispatch). */
export function isLikelySalesPipelineName(name: string): boolean {
  return Boolean(name) && !NON_SALES_PIPELINE_RE.test(name);
}
