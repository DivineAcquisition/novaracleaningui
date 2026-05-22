// ─── Secret resolver ───────────────────────────────────────────────────
//
// Reads a named secret from public.app_secrets first (DB-backed
// override layer that operators with SQL access can rotate without
// touching Supabase Dashboard) and falls back to the Edge Function's
// own Deno.env.get(...) value if the DB row is missing/empty.
//
// Why have both?
//   • Stripe credentials need to be rotated frequently, and the only
//     way to do that without dashboard access is through SQL.
//   • Other secrets (Resend, Telnyx, Google) still live in env vars
//     where they're fine — this helper just hands them back unchanged
//     if there's no DB override.
//
// Results are cached per cold start so we don't hit Postgres on every
// invocation. Cache is keyed by name → resolved string.

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = { from: (table: string) => any };

const cache = new Map<string, string>();

/**
 * Resolve a named secret. Order of precedence:
 *   1. public.app_secrets row with this key (DB override layer)
 *   2. Deno.env.get(name) (the standard Edge Function secret)
 *
 * Returns "" when neither source has a non-empty value. Never throws.
 * Always returns a string.
 */
export async function resolveSecret(
  supabase: SupabaseClientLike,
  name: string,
): Promise<string> {
  if (cache.has(name)) return cache.get(name) ?? "";
  let value = "";
  let dbHit = false;
  try {
    // deno-lint-ignore no-explicit-any
    const { data } = await (supabase as any)
      .from("app_secrets")
      .select("value")
      .eq("key", name)
      .maybeSingle();
    if (data?.value && typeof data.value === "string") {
      const trimmed = data.value.trim();
      if (trimmed) {
        value = trimmed;
        dbHit = true;
      }
    }
  } catch (err) {
    console.warn(`[app-secrets] DB read failed for ${name}`, err instanceof Error ? err.message : String(err));
  }
  if (!value) {
    value = (Deno.env.get(name) || "").trim();
  }
  // Only cache when the value came from the DB. Env fallbacks are
  // re-checked on every call so a later DB rotation immediately wins
  // without waiting for the instance to be recycled — the original
  // cache-on-fallback behaviour pinned warm instances to a stale env
  // var for hours after we rotated Stripe keys.
  if (dbHit) cache.set(name, value);
  return value;
}

/** Synchronous fallback for callers that already created a Stripe client
 *  earlier with an env value and want a hint about whether the DB layer
 *  has a different value pending. Returns the cached value or "". */
export function cachedSecret(name: string): string {
  return cache.get(name) ?? "";
}

/** Invalidate the in-memory cache. Used by ops tooling after rotating
 *  a value in app_secrets — the next invocation reads the fresh row. */
export function clearSecretCache(name?: string) {
  if (name) cache.delete(name);
  else cache.clear();
}
