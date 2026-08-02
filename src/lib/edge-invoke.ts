// ─── Reading what an Edge Function actually said ─────────────────────────────
//
// `supabase.functions.invoke()` collapses every non-2xx response into a
// FunctionsHttpError whose message is the famously unhelpful
// "Edge Function returned a non-2xx status code". The real reason — "GHL not
// configured", "unable to resolve contactId", Telnyx's rejection text — is
// sitting in `error.context`, which is the raw Response.
//
// Losing that is how an operator ends up staring at "Action failed" with no
// idea whether to fix a phone number or a missing API token. These helpers pull
// the body back out so failures can be reported in terms of what to DO about
// them. `supabase/functions/_shared/sms.ts` does the same thing edge-side; this
// is the app-side twin.

interface InvokeErrorLike {
  message?: string;
  context?: unknown;
  name?: string;
}

const GENERIC = "Edge Function returned a non-2xx status code";

/**
 * Render whatever a function put in `error` as something an operator can act
 * on. Postgres errors arrive as plain objects, and `String(obj)` on one gives
 * "[object Object]" — which is worse than the generic message it replaced.
 */
function stringifyReason(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const o = value as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [o.message, o.details, o.hint].filter(Boolean);
    if (parts.length > 0) return `${parts.join(" — ")}${o.code ? ` (${o.code})` : ""}`;
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return value == null ? "" : String(value);
}

/** Pull the useful text out of an invoke() failure. Never throws. */
export async function describeEdgeError(error: unknown, data?: unknown): Promise<string> {
  const err = error as InvokeErrorLike | null;

  // The response body, when supabase-js handed us the Response object.
  try {
    const ctx = err?.context as { text?: () => Promise<string>; bodyUsed?: boolean } | undefined;
    if (ctx && typeof ctx.text === "function" && !ctx.bodyUsed) {
      const text = (await ctx.text()).trim();
      if (text) {
        try {
          const parsed = JSON.parse(text) as { error?: unknown; message?: unknown; body?: unknown };
          const inner = stringifyReason(parsed.error ?? parsed.message ?? parsed.body);
          if (inner) return inner.slice(0, 400);
        } catch {
          /* not JSON — the raw text is still better than the generic message */
        }
        return text.slice(0, 400);
      }
    }
  } catch {
    /* fall through to the message */
  }

  // Some functions answer 200 with { error } in the body.
  const inBody = stringifyReason((data as { error?: unknown } | null)?.error);
  if (inBody) return inBody.slice(0, 400);

  if (typeof error === "string" && error) return error.slice(0, 400);
  if (err?.message && err.message !== GENERIC) return err.message.slice(0, 400);
  return "The function failed without saying why — check its logs.";
}

export interface EdgeOutcome {
  ok: boolean;
  /** Populated only when ok is false. */
  error: string | null;
}

/**
 * Did this invoke actually succeed?
 *
 * A function that answers 200 with `{ error: "..." }` has NOT succeeded, and
 * several of ours do exactly that. Treating an HTTP 200 as delivery is how a
 * "sent" flag ends up lying to an operator.
 *
 * Returns a flat shape rather than a discriminated union because this project
 * compiles with strictNullChecks off, where narrowing on a literal `ok` is not
 * dependable.
 */
export async function edgeResult(error: unknown, data: unknown): Promise<EdgeOutcome> {
  const bodyError = (data as { error?: string } | null)?.error;
  if (!error && !bodyError) return { ok: true, error: null };
  return { ok: false, error: await describeEdgeError(error, data) };
}
