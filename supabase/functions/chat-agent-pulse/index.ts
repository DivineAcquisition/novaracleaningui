// ─── chat-agent-pulse — autonomous rhythm ──────────────────────────────
//
// Runs every 4 hours via pg_cron job 16 (chat-agent-pulse-every-4h).
//
// Each tick:
//   1. Lists GHL conversations with activity in the last 36 hours
//      (window padding so a missed tick doesn't drop messages).
//   2. For each, reads chat_insights and skips conversations whose
//      lastMessageDate hasn't moved since the previous analysis —
//      saves both LLM tokens and GHL API calls.
//   3. Invokes admin-chat-agent with autoApply=true, persist=true so:
//        • extracted GHL custom fields land on the contact
//        • tag recommendations are added to the contact
//        • an audit row upserts into public.chat_insights
//   4. Returns a tally of analyzed / skipped / mapped / errors.

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

    const lookbackHours = Number(body.lookbackHours) > 0 ? Number(body.lookbackHours) : 36;
    const cap = Number(body.maxConversations) > 0
      ? Math.min(Number(body.maxConversations), 200)
      : 75;
    const lookbackCutoff = Date.now() - lookbackHours * 60 * 60 * 1000;

    // 1. Walk GHL conversations sorted by lastMessageDate desc until we
    //    fall off the lookback window or hit the cap.
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
        if (ts < lookbackCutoff) {
          offset = -1;
          break;
        }
        conversations.push(c);
        kept++;
        if (conversations.length >= cap) break;
      }
      if (offset === -1) break;
      offset += page.length;
      if (kept === 0) break;
    }

    // 2. Skip conversations whose lastMessageDate hasn't moved since
    //    last analysis.
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

    const stats = {
      listed: conversations.length,
      analyzed: 0,
      skipped_unchanged: 0,
      mapped: 0,
      errors: 0,
      total_fields_applied: 0,
      total_tags_applied: 0,
    };
    const details: any[] = [];

    for (const c of conversations) {
      const lastMsgIso = asISO(c.lastMessageDate);
      const lastAnalyzed = existing[c.id];
      if (lastMsgIso && lastAnalyzed && Date.parse(lastAnalyzed) >= Date.parse(lastMsgIso)) {
        stats.skipped_unchanged++;
        details.push({ conversation_id: c.id, status: "skipped_unchanged" });
        continue;
      }
      try {
        const r = await supabase.functions.invoke("admin-chat-agent", {
          body: {
            conversationId: c.id,
            contactId: c.contactId,
            email: c.email,
            phone: c.phone,
            limit: 50,
            autoApply: true,
            persist: true,
          },
        });
        if (r.error) {
          stats.errors++;
          details.push({
            conversation_id: c.id,
            status: "error",
            error: r.error.message || String(r.error),
          });
          continue;
        }
        const data = r.data as any;
        if (!data?.ok) {
          stats.errors++;
          details.push({
            conversation_id: c.id,
            status: "error",
            error: data?.reason || "unknown",
          });
          continue;
        }
        stats.analyzed++;
        const appliedFields = Object.keys(data?.extracted_fields || {}).length;
        const appliedTags = (data?.tag_recommendations || []).length;
        if (appliedFields > 0 || appliedTags > 0) {
          stats.mapped++;
          stats.total_fields_applied += appliedFields;
          stats.total_tags_applied += appliedTags;
        }
        details.push({
          conversation_id: c.id,
          status: "analyzed",
          urgency: data?.analysis?.recommended_next_action?.urgency,
          stage: data?.analysis?.stage,
          temperature: data?.analysis?.lead_temperature,
          fields: appliedFields,
          tags: appliedTags,
        });
      } catch (e) {
        stats.errors++;
        details.push({
          conversation_id: c.id,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        tick_started_at: new Date(startedAt).toISOString(),
        tick_duration_ms: Date.now() - startedAt,
        stats,
        details: details.slice(0, 50),
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
