// ─── chat-agent-pulse — autonomous rhythm v2 (parallelized) ────────────
//
// Runs every 4 hours via pg_cron job 16 (chat-agent-pulse-every-4h).
//
// Each tick:
//   1. Lists GHL conversations sorted by last_message_date desc with
//      a 36-hour lookback window.
//   2. Joins against chat_insights and skips conversations whose
//      lastMessageDate hasn't moved since the previous analysis.
//   3. Fans the survivors out through admin-chat-agent with autoApply
//      + persist using a sliding-window concurrency runner so a single
//      tick fits under Supabase's 150s edge timeout.
//   4. Reports listed / analyzed / skipped_unchanged / mapped / errors
//      plus per-conversation details.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

async function resolveSecret(supabase: any, name: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("app_secrets")
      .select("value")
      .eq("key", name)
      .maybeSingle();
    if (data?.value && typeof data.value === "string") return data.value.trim();
  } catch {}
  return (Deno.env.get(name) || "").trim();
}

async function ghl(token: string, path: string) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, body: body ?? text };
}

function asISO(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === "number") return new Date(input).toISOString();
  if (typeof input === "string") {
    const t = Date.parse(input);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}

// Sliding-window concurrency runner: keep `concurrency` requests in
// flight at all times until the queue drains. Cheaper than batched
// Promise.all because slow workers don't block the next batch.
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function pump() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => pump(),
  );
  await Promise.all(workers);
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const ghlToken = await resolveSecret(supabase, "GHL_PIT_TOKEN");
    const ghlLocationId = await resolveSecret(supabase, "GHL_LOCATION_ID");
    if (!ghlToken || !ghlLocationId) {
      return new Response(
        JSON.stringify({ ok: false, reason: "GHL credentials not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Tunables sized for Supabase 150s edge timeout. Each Claude
    // analysis is ~15-20s, so 12 conversations × 4 in flight ≈ 60-90s.
    const lookbackHours = Number(body.lookbackHours) > 0 ? Number(body.lookbackHours) : 36;
    const cap = Number(body.maxConversations) > 0
      ? Math.min(Number(body.maxConversations), 50)
      : 12;
    const concurrency = Number(body.concurrency) > 0
      ? Math.min(Number(body.concurrency), 6)
      : 4;
    const lookbackCutoff = Date.now() - lookbackHours * 60 * 60 * 1000;

    // 1. Walk GHL conversations sorted by lastMessageDate desc.
    const conversations: Array<any> = [];
    let offset = 0;
    while (conversations.length < cap) {
      const res = await ghl(
        ghlToken,
        `/conversations/search?locationId=${encodeURIComponent(ghlLocationId)}&sort=desc&sortBy=last_message_date&limit=50&startAfter=${offset}`,
      );
      if (!res.ok) break;
      const page = ((res.body as any)?.conversations ?? []) as any[];
      if (page.length === 0) break;
      let kept = 0;
      for (const c of page) {
        const ts = typeof c.lastMessageDate === "number"
          ? c.lastMessageDate
          : Date.parse(c.lastMessageDate || "");
        if (!Number.isFinite(ts)) continue;
        if (ts < lookbackCutoff) { offset = -1; break; }
        conversations.push(c);
        kept++;
        if (conversations.length >= cap) break;
      }
      if (offset === -1) break;
      offset += page.length;
      if (kept === 0) break;
    }

    // 2. Skip conversations that haven't moved since last analysis.
    const ids = conversations.map((c) => c.id).filter(Boolean);
    const existing: Record<string, string | null> = {};
    if (ids.length > 0) {
      const { data } = await supabase
        .from("chat_insights")
        .select("conversation_id, last_analyzed_message_ts")
        .in("conversation_id", ids);
      for (const row of (data || []) as any[]) {
        existing[row.conversation_id] = row.last_analyzed_message_ts;
      }
    }
    const todo: any[] = [];
    const skipped: any[] = [];
    for (const c of conversations) {
      const lastMsgIso = asISO(c.lastMessageDate);
      const lastAnalyzed = existing[c.id];
      if (lastMsgIso && lastAnalyzed && Date.parse(lastAnalyzed) >= Date.parse(lastMsgIso)) {
        skipped.push({ conversation_id: c.id, status: "skipped_unchanged" });
      } else {
        todo.push(c);
      }
    }

    // 3. Fan out the agent in parallel.
    const stats = {
      listed: conversations.length,
      analyzed: 0,
      skipped_unchanged: skipped.length,
      mapped: 0,
      errors: 0,
      total_fields_applied: 0,
      total_tags_applied: 0,
    };
    const details: any[] = [...skipped];

    const results = await runWithConcurrency(todo, concurrency, async (c) => {
      try {
        // Pass the conversation's lastMessageDate so the agent stores
        // exactly that value as last_analyzed_message_ts. Otherwise the
        // agent falls back to messages[last].ts which can differ by
        // sub-second precision from GHL's lastMessageDate, causing the
        // conversation to be re-analyzed every tick.
        const r = await supabase.functions.invoke("admin-chat-agent", {
          body: {
            conversationId: c.id,
            contactId: c.contactId,
            email: c.email,
            phone: c.phone,
            lastMessageDateOverride: asISO(c.lastMessageDate),
            limit: 50,
            autoApply: true,
            persist: true,
          },
        });
        if (r.error) {
          return {
            conversation_id: c.id,
            status: "error" as const,
            error: r.error.message || String(r.error),
          };
        }
        const data = r.data as any;
        if (!data?.ok) {
          return {
            conversation_id: c.id,
            status: "error" as const,
            error: data?.reason || "unknown",
          };
        }
        return {
          conversation_id: c.id,
          status: "analyzed" as const,
          urgency: data?.analysis?.recommended_next_action?.urgency,
          stage: data?.analysis?.stage,
          temperature: data?.analysis?.lead_temperature,
          fields: Object.keys(data?.extracted_fields || {}).length,
          tags: (data?.tag_recommendations || []).length,
        };
      } catch (e) {
        return {
          conversation_id: c.id,
          status: "error" as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });

    for (const d of results) {
      details.push(d);
      if (d.status === "analyzed") {
        stats.analyzed++;
        const fields = (d as any).fields || 0;
        const tags = (d as any).tags || 0;
        if (fields > 0 || tags > 0) {
          stats.mapped++;
          stats.total_fields_applied += fields;
          stats.total_tags_applied += tags;
        }
      } else if (d.status === "error") {
        stats.errors++;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        tick_started_at: new Date(startedAt).toISOString(),
        tick_duration_ms: Date.now() - startedAt,
        params: { lookbackHours, cap, concurrency },
        stats,
        details: details.slice(0, 60),
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
