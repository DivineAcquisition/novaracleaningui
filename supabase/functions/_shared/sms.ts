// ─── SMS helper (Telnyx via send-sms-notification) ─────────────────────────
//
// Thin wrapper over the existing `send-sms-notification` Edge Function so
// other functions can fire SMS without duplicating boilerplate. Failures are
// swallowed and logged — callers should treat SMS as best-effort.

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = { functions: { invoke: (name: string, opts: any) => Promise<any> } };

export type SmsType = "job_offer" | "reminder" | "confirmation" | "verification";

export interface SendSmsArgs {
  toPhone: string | null | undefined;
  message: string;
  type?: SmsType;
  jobAssignmentId?: string;
}

const SUPPORTED_TYPES: SmsType[] = ["job_offer", "reminder", "confirmation", "verification"];

// Extract a readable error string from a supabase.functions.invoke failure.
// On non-2xx responses supabase-js returns a FunctionsHttpError whose
// `context` is the raw Response — the useful details (e.g. GHL's
// "has unsubscribed") live in that body, so read it when available.
// deno-lint-ignore no-explicit-any
async function describeInvokeError(err: any, data: any): Promise<string> {
  try {
    const ctx = err?.context;
    if (ctx && typeof ctx.text === "function" && !ctx.bodyUsed) {
      const text = await ctx.text();
      if (text) return text;
    }
  } catch { /* fall through */ }
  if (typeof err === "string") return err;
  if (err?.message && err.message !== "Edge Function returned a non-2xx status code") return String(err.message);
  try {
    return JSON.stringify(data ?? err);
  } catch {
    return String(err);
  }
}

/**
 * Fire a Telnyx SMS via the `send-sms-notification` Edge Function.
 * Never throws — returns true if the invocation succeeded, false otherwise.
 */
export async function sendSms(
  supabase: SupabaseClientLike,
  args: SendSmsArgs,
): Promise<boolean> {
  const phone = (args.toPhone || "").toString().trim();
  if (!phone) {
    console.log("[sendSms] Skipped — no phone");
    return false;
  }
  if (!args.message || !args.message.trim()) {
    console.log("[sendSms] Skipped — no message");
    return false;
  }

  const type: SmsType = args.type && SUPPORTED_TYPES.includes(args.type) ? args.type : "confirmation";

  // Primary: GoHighLevel. Backup: Telnyx (send-sms-notification).
  // When GHL is down (quota, outage), Telnyx must deliver on its own —
  // so the Telnyx call skips re-entering GHL.
  try {
    const { data, error } = await supabase.functions.invoke("send-ghl-sms", {
      body: { phone, message: args.message, type },
    });
    const ghlError = error || (data && (data as { error?: string }).error);
    if (!ghlError) return true;

    // PERMANENT failure: the recipient texted STOP. Never retry, and never
    // route around the opt-out via another transport — that's a TCPA
    // violation. Report success so cron callers stamp their sent_at marker
    // and stop re-attempting every sweep.
    const errText = await describeInvokeError(ghlError, data);
    if (/unsubscrib/i.test(errText)) {
      console.warn(`[sendSms] Recipient has unsubscribed (STOP) — dropping message permanently`, { phone });
      return true;
    }
    console.warn("[sendSms] GHL send failed, falling back to Telnyx", errText.slice(0, 300));
  } catch (err) {
    console.warn(
      "[sendSms] GHL send threw, falling back to Telnyx",
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    const { data, error } = await supabase.functions.invoke("send-sms-notification", {
      body: {
        toPhone: phone,
        message: args.message,
        type,
        jobAssignmentId: args.jobAssignmentId,
        skipGhlFallback: true,
      },
    });
    if (error || (data && (data as { error?: string }).error)) {
      console.error("[sendSms] Telnyx fallback invoke error", error || data);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[sendSms] Telnyx fallback threw", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Build a friendly "Mon, Jan 5" style label for a YYYY-MM-DD date string.
 * Falls back to the raw string if parsing fails.
 */
export function formatServiceDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

/**
 * Build a "8:00 AM – 12:00 PM" style label for a stored time-slot id.
 */
export function formatTimeSlot(slot?: string | null): string {
  if (!slot) return "";
  const map: Record<string, string> = {
    "8-12": "8:00 AM – 12:00 PM",
    "12-16": "12:00 PM – 4:00 PM",
    "16-20": "4:00 PM – 8:00 PM",
  };
  return map[slot] || slot;
}

/**
 * Parse a stored time-slot into 24h "HH:MM:SS" start/end clocks. Handles
 * the canonical arrival-window ids ("8-12", "12-16", "16-20"), the named
 * windows ("morning"/"midday"/"afternoon"/"evening"), and freeform
 * "8:00 AM - 12:00 PM" / "9-12" strings. Returns null start/end when it
 * can't make sense of the value so callers can apply their own default.
 *
 * This is the single source of truth for turning a booking's time_slot
 * into a job start time — used to be duplicated (and broken) across the
 * dispatch functions, where everything silently defaulted to 09:00.
 */
export function parseTimeSlotToClock(
  slot?: string | null,
): { start: string | null; end: string | null } {
  if (!slot) return { start: null, end: null };
  const raw = String(slot).trim();

  // Canonical arrival-window ids the booking funnel stores.
  const canonical: Record<string, { start: string; end: string }> = {
    "8-12": { start: "08:00:00", end: "12:00:00" },
    "12-16": { start: "12:00:00", end: "16:00:00" },
    "16-20": { start: "16:00:00", end: "20:00:00" },
  };
  if (canonical[raw]) return canonical[raw];

  // Named windows used by some legacy callers.
  const named: Record<string, { start: string; end: string }> = {
    morning: { start: "08:00:00", end: "12:00:00" },
    midday: { start: "12:00:00", end: "16:00:00" },
    afternoon: { start: "12:00:00", end: "16:00:00" },
    evening: { start: "16:00:00", end: "20:00:00" },
  };
  if (named[raw.toLowerCase()]) return named[raw.toLowerCase()];

  // Freeform "9:00 AM - 12:00 PM" or "9-12".
  const m = raw.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?\s*-\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (!m) return { start: null, end: null };
  const toClock = (h: string, mm: string | undefined, mer: string | undefined) => {
    let hour = parseInt(h, 10);
    if (Number.isNaN(hour)) return null;
    if (mer) {
      const u = mer.toUpperCase();
      if (u === "PM" && hour < 12) hour += 12;
      if (u === "AM" && hour === 12) hour = 0;
    }
    return `${String(hour).padStart(2, "0")}:${(mm || "00").padStart(2, "0")}:00`;
  };
  return { start: toClock(m[1], m[2], m[3]), end: toClock(m[4], m[5], m[6]) };
}
