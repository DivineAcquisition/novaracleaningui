// Job Dispatch pipeline — stage discovery + booking → stage mapping.

export interface GhlDispatchConfig {
  token: string;
  locationId: string;
}

export type DispatchStageKey =
  | "unassigned"
  | "offered"
  | "accepted"
  | "declined"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "verified"
  | "paid";

const STAGE_NAME_PATTERNS: Record<DispatchStageKey, RegExp[]> = {
  unassigned: [/^unassigned$/i],
  offered: [/^offered$/i],
  accepted: [/^accepted$/i],
  declined: [/declined/i, /no response/i],
  scheduled: [/^scheduled$/i],
  in_progress: [/in progress/i],
  completed: [/^completed$/i],
  verified: [/^verified$/i],
  paid: [/^paid$/i],
};

// Match the fulfillment pipeline by name. We accept "Job Dispatch",
// "Dispatch", "Fulfillment", or "Job Board" so a slightly different label
// in GHL still resolves (set GHL_DISPATCH_PIPELINE_ID to override).
const PIPELINE_NAME_RE = /job\s*dispatch|dispatch|fulfil|fulfill|job\s*board/i;

export interface DispatchPipelineConfig {
  pipelineId: string;
  stages: Record<DispatchStageKey, string | undefined>;
}

let dispatchCache: DispatchPipelineConfig | null = null;
let dispatchCachePromise: Promise<DispatchPipelineConfig | null> | null = null;

type PipelineJson = {
  id?: string;
  name?: string;
  stages?: Array<{ id?: string; name?: string; position?: number }>;
};

/** Fetch pipelines and resolve "Job Dispatch" + stage IDs (env overrides win). */
export async function resolveJobDispatchPipeline(
  cfg: GhlDispatchConfig,
  ghlFetch: (cfg: GhlDispatchConfig, path: string, init?: RequestInit) => Promise<Response>,
): Promise<DispatchPipelineConfig | null> {
  if (dispatchCache) return dispatchCache;
  if (dispatchCachePromise) return await dispatchCachePromise;

  dispatchCachePromise = (async () => {
    // deno-lint-ignore no-explicit-any
    const env = (globalThis as any).Deno?.env;
    const envPipelineId = (env?.get("GHL_DISPATCH_PIPELINE_ID") || "").trim();
    const envStages: Partial<Record<DispatchStageKey, string>> = {};
    if (env) {
      for (const key of Object.keys(STAGE_NAME_PATTERNS) as DispatchStageKey[]) {
        const id = (env.get(`GHL_DISPATCH_STAGE_${key.toUpperCase()}`) || "").trim();
        if (id) envStages[key] = id;
      }
    }

    let pipelineId = envPipelineId;
    let pipelines: PipelineJson[] = [];

    try {
      const res = await ghlFetch(
        cfg,
        `/opportunities/pipelines?locationId=${encodeURIComponent(cfg.locationId)}`,
      );
      if (res.ok) {
        const json = await res.json();
        pipelines = (json.pipelines ?? []) as PipelineJson[];
      }
    } catch {
      /* ignore */
    }

    const dispatchPipeline = pipelines.find((p) => PIPELINE_NAME_RE.test(p.name || ""));
    if (!pipelineId && dispatchPipeline?.id) pipelineId = dispatchPipeline.id;
    if (!pipelineId) return null;

    const stageList = dispatchPipeline?.stages ?? pipelines.find((p) => p.id === pipelineId)?.stages ?? [];
    const stages: Record<DispatchStageKey, string | undefined> = {
      unassigned: envStages.unassigned,
      offered: envStages.offered,
      accepted: envStages.accepted,
      declined: envStages.declined,
      scheduled: envStages.scheduled,
      in_progress: envStages.in_progress,
      completed: envStages.completed,
      verified: envStages.verified,
      paid: envStages.paid,
    };

    for (const stage of stageList) {
      if (!stage.id || !stage.name) continue;
      for (const [key, patterns] of Object.entries(STAGE_NAME_PATTERNS) as Array<
        [DispatchStageKey, RegExp[]]
      >) {
        if (stages[key]) continue;
        if (patterns.some((re) => re.test(stage.name || ""))) {
          stages[key] = stage.id;
        }
      }
    }

    const result: DispatchPipelineConfig = { pipelineId, stages };
    dispatchCache = result;
    return result;
  })();

  return await dispatchCachePromise;
}

export interface DispatchStageContext {
  bookingStatus?: string | null;
  jobStatus?: string | null;
  payoutStatus?: string | null;
  cleanerId?: string | null;
  assignmentStatuses?: string[];
  serviceDate?: string | null;
}

/** Infer Job Dispatch pipeline stage from booking + job + assignments. */
export function inferDispatchStage(ctx: DispatchStageContext): DispatchStageKey {
  const bookingStatus = String(ctx.bookingStatus || "").toLowerCase();
  const jobStatus = String(ctx.jobStatus || "");
  const payoutStatus = String(ctx.payoutStatus || "").toLowerCase();
  const assigns = (ctx.assignmentStatuses || []).map((s) => String(s).toLowerCase());

  if (bookingStatus === "cancelled") return "declined";
  if (payoutStatus === "completed" || payoutStatus === "paid") return "paid";

  if (bookingStatus === "completed") {
    if (payoutStatus === "pending" || payoutStatus === "processing") return "verified";
    return "completed";
  }

  if (bookingStatus === "in_progress" || jobStatus === "In Progress") return "in_progress";

  const hasOffered = assigns.some((s) => s === "offered" || s === "broadcast");
  const hasDeclinedOnly = assigns.length > 0 &&
    assigns.every((s) =>
      ["declined", "expired", "withdrawn", "broadcast_lost", "cancelled"].includes(s)
    );
  const hasAccepted = assigns.some((s) =>
    ["accepted", "confirmed", "assigned", "in progress", "completed"].includes(s)
  );

  if (hasOffered && !hasAccepted) return "offered";
  if (hasDeclinedOnly && !ctx.cleanerId) return "declined";

  if (
    ctx.cleanerId &&
    (bookingStatus === "assigned" || hasAccepted) &&
    ctx.serviceDate
  ) {
    return "scheduled";
  }

  if (hasAccepted || (ctx.cleanerId && bookingStatus === "assigned")) return "accepted";

  if (bookingStatus === "confirmed" || bookingStatus === "pending_details") return "unassigned";

  return "unassigned";
}

export function stageIdForKey(
  config: DispatchPipelineConfig,
  key: DispatchStageKey,
): string | undefined {
  return config.stages[key] || config.stages.unassigned;
}
