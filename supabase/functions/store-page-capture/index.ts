// ─── store-page-capture ─────────────────────────────────────────────────
//
// Receives a browser screenshot of a customer-facing funnel page (checkout
// or agreement/signature), stores it in the private page-captures bucket,
// and records it in public.page_captures. qc-drive-mirror embeds the latest
// capture per kind into the job's dispute packet.
//
// Body: { bookingId, kind: "checkout" | "agreement", imageBase64,
//         pageUrl?, imageWidth?, imageHeight?, viewportWidth?, viewportHeight? }
//
// Public (verify_jwt = false) because it runs inside the un-authenticated
// booking funnel, mirroring store-service-agreement. The booking must exist,
// the kind is allow-listed, and the payload is size-capped.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const KINDS = new Set(["checkout", "agreement"]);
const MAX_BYTES = 6 * 1024 * 1024;

const log = (s: string, d?: unknown) =>
  console.log(`[store-page-capture] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.bookingId || "").trim();
    const kind = String(body?.kind || "").trim();
    const imageBase64 = String(body?.imageBase64 || "");

    if (!bookingId) return json({ error: "bookingId required" }, 400);
    if (!KINDS.has(kind)) return json({ error: "unsupported kind" }, 400);
    if (!imageBase64) return json({ error: "imageBase64 required" }, 400);
    if (imageBase64.length * 0.75 > MAX_BYTES) return json({ error: "image too large" }, 413);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking } = await supabase
      .from("bookings")
      .select("id")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return json({ error: "booking not found" }, 404);

    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    } catch {
      return json({ error: "imageBase64 is not valid base64" }, 400);
    }
    if (bytes.length === 0) return json({ error: "empty image" }, 400);

    const path = `${bookingId}/${kind}-${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from("page-captures")
      .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (upErr) throw upErr;

    const { data: row, error: insErr } = await supabase
      .from("page_captures")
      .insert({
        booking_id: bookingId,
        kind,
        storage_path: path,
        page_url: body?.pageUrl ? String(body.pageUrl).slice(0, 500) : null,
        image_width: body?.imageWidth ? Number(body.imageWidth) : null,
        image_height: body?.imageHeight ? Number(body.imageHeight) : null,
        viewport_width: body?.viewportWidth ? Number(body.viewportWidth) : null,
        viewport_height: body?.viewportHeight ? Number(body.viewportHeight) : null,
        byte_size: bytes.length,
        ip: req.headers.get("x-forwarded-for") || null,
        user_agent: req.headers.get("user-agent") || null,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    log("stored", { bookingId, kind, path, bytes: bytes.length });
    return json({ ok: true, id: row.id, path });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ error: msg }, 500);
  }
});
