// ─── turnover-photos ───────────────────────────────────────────────────────
//
// One self-contained endpoint that powers the public, token-protected
// /cleaner/turnover-photos/[token] page so an SMS-only cleaner (no login) can
// submit before/after photos for a turnover and finish the job. It also sends
// the upload-link SMS (op: "sendlink"), invoked by the DB trigger the moment a
// turnover is assigned.
//
// Ops (POST body { op, ... }):
//   • get      { token }                      → turnover detail for the form
//   • submit   { token, beforeUrls?, afterUrls? }
//                                              → merge photos; if any after
//                                                photos exist, finalize the
//                                                turnover via partner-turnover
//                                                cleaner.complete (charges +
//                                                notifies the host with photos)
//   • sendlink { turnoverId }                 → SMS the assigned cleaner the
//                                                upload link (trigger only)
//
// Photos are uploaded client-side straight into the public `turnover-photos`
// Storage bucket; this function only receives the resulting public URLs.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLEANER_SHARE = 0.7;
const APP_BASE = (Deno.env.get("TURNOVER_PHOTO_BASE") || "https://app.novaracleaning.com").replace(/\/$/, "");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function money(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

// deno-lint-ignore no-explicit-any
type SB = ReturnType<typeof createClient<any>>;

async function loadContext(admin: SB, tr: Record<string, unknown>) {
  let property: Record<string, unknown> | null = null;
  if (tr.property_id) {
    const { data } = await admin
      .from("properties")
      .select("nickname, address")
      .eq("id", tr.property_id)
      .maybeSingle();
    property = data;
  }
  let cleaner: Record<string, unknown> | null = null;
  if (tr.assigned_cleaner_id) {
    const { data } = await admin
      .from("cleaners")
      .select("id, first_name, phone")
      .eq("id", tr.assigned_cleaner_id)
      .maybeSingle();
    cleaner = data;
  }
  return { property, cleaner };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, reason: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const op = String((body as Record<string, unknown>)?.op || "get");

    // ── sendlink (trigger) ────────────────────────────────────────────────
    if (op === "sendlink") {
      const turnoverId = String((body as Record<string, unknown>)?.turnoverId || "");
      if (!turnoverId) return json({ ok: false, reason: "missing_turnoverId" }, 400);

      const { data: tr } = await admin
        .from("turnover_requests")
        .select("*")
        .eq("id", turnoverId)
        .maybeSingle();
      if (!tr) return json({ ok: false, reason: "not_found" }, 404);

      let token = tr.photo_upload_token as string | null;
      if (!token) {
        token = crypto.randomUUID().replace(/-/g, "");
        await admin.from("turnover_requests").update({ photo_upload_token: token }).eq("id", tr.id);
      }

      const { property, cleaner } = await loadContext(admin, tr);
      const phone = (cleaner?.phone as string) || "";
      if (!phone) return json({ ok: false, reason: "no_cleaner_phone" }, 200);

      const nickname = (property?.nickname as string) || (property?.address as string) || "the property";
      const dateLabel = formatDate(tr.requested_date as string);
      const share = money(Number(tr.price || 0) * CLEANER_SHARE);
      const link = `${APP_BASE}/cleaner/turnover-photos/${token}`;
      const message =
        `Turnover ${nickname}${dateLabel ? ` (${dateLabel})` : ""} — pay ${share}. ` +
        `When it's guest-ready, upload your before & after photos here to finish & get paid: ${link}`;

      try {
        await admin.functions.invoke("send-ghl-sms", {
          body: { phone, message, type: "job_offer" },
        });
      } catch (e) {
        console.warn("[turnover-photos] sendlink SMS failed", e instanceof Error ? e.message : String(e));
      }
      await admin
        .from("turnover_requests")
        .update({ photo_upload_sent_at: new Date().toISOString() })
        .eq("id", tr.id);
      return json({ ok: true, sent: true });
    }

    // ── token-based ops (public) ──────────────────────────────────────────
    const token = String((body as Record<string, unknown>)?.token || "");
    if (!token) return json({ ok: false, reason: "missing_token" }, 400);

    const { data: tr } = await admin
      .from("turnover_requests")
      .select("*")
      .eq("photo_upload_token", token)
      .maybeSingle();
    if (!tr) return json({ ok: false, reason: "not_found" }, 404);

    const { property, cleaner } = await loadContext(admin, tr);

    if (op === "get") {
      const before = Array.isArray(tr.before_photos) ? (tr.before_photos as string[]) : [];
      const after = Array.isArray(tr.after_photos) ? (tr.after_photos as string[]) : [];
      return json({
        ok: true,
        turnoverId: tr.id,
        status: tr.status,
        propertyName: (property?.nickname as string) || (property?.address as string) || "Turnover",
        addressLine: (property?.address as string) || null,
        date: tr.requested_date,
        dateLabel: formatDate(tr.requested_date as string),
        cleanerFirstName: (cleaner?.first_name as string) || null,
        pay: money(Number(tr.price || 0) * CLEANER_SHARE),
        beforeCount: before.length,
        afterCount: after.length,
        alreadySubmitted: !!tr.photo_upload_submitted_at || tr.status === "completed",
      });
    }

    if (op === "submit") {
      const beforeUrls = Array.isArray((body as Record<string, unknown>)?.beforeUrls)
        ? ((body as Record<string, unknown>).beforeUrls as unknown[]).filter((u) => typeof u === "string") as string[]
        : [];
      const afterUrls = Array.isArray((body as Record<string, unknown>)?.afterUrls)
        ? ((body as Record<string, unknown>).afterUrls as unknown[]).filter((u) => typeof u === "string") as string[]
        : [];
      if (beforeUrls.length === 0 && afterUrls.length === 0) {
        return json({ ok: false, reason: "no_photos" }, 400);
      }

      const existingBefore = Array.isArray(tr.before_photos) ? (tr.before_photos as string[]) : [];
      const existingAfter = Array.isArray(tr.after_photos) ? (tr.after_photos as string[]) : [];
      const mergedBefore = Array.from(new Set([...existingBefore, ...beforeUrls].filter(Boolean)));
      const mergedAfter = Array.from(new Set([...existingAfter, ...afterUrls].filter(Boolean)));

      await admin
        .from("turnover_requests")
        .update({
          before_photos: mergedBefore,
          after_photos: mergedAfter,
          photo_upload_submitted_at: new Date().toISOString(),
        })
        .eq("id", tr.id);

      // If there's at least one after photo, finalize the turnover through the
      // canonical path (charges the balance + texts/emails the host the photos).
      let completed = false;
      if (mergedAfter.length > 0 && tr.status !== "completed") {
        try {
          await admin.functions.invoke("partner-turnover", {
            body: {
              action: "cleaner.complete",
              turnoverId: tr.id,
              cleanerId: tr.assigned_cleaner_id,
              after_photos: mergedAfter,
            },
          });
          completed = true;
        } catch (e) {
          console.warn("[turnover-photos] complete invoke failed", e instanceof Error ? e.message : String(e));
        }
      }

      return json({
        ok: true,
        completed,
        beforeCount: mergedBefore.length,
        afterCount: mergedAfter.length,
      });
    }

    return json({ ok: false, reason: `unknown_op:${op}` }, 400);
  } catch (err) {
    return json({ ok: false, reason: "server_error", message: (err as Error).message }, 500);
  }
});
