// ─── get-job-photos ────────────────────────────────────────────────────────
//
// Public, token-protected resolver behind the open before/after photo gallery
// at /photos/[token]. Customers (regular bookings) and partner hosts (STR
// turnovers) open this link from the completion SMS/email to see proof-of-work
// photos — no login required.
//
// The same token namespace covers both job kinds: we look the token up first
// against bookings.photo_view_token, then turnover_requests.photo_view_token.
//
// Body / query: { token: string }
// Response (200): {
//   ok: true,
//   kind: "booking" | "turnover",
//   title,            // friendly heading ("Your clean on Mon, Jan 5")
//   serviceDate,
//   addressLine,      // street + city only (no unit / ZIP / PII)
//   cleanerFirstName,
//   completedAt,
//   beforePhotos: string[],
//   afterPhotos: string[],
// }
// Response (404): { ok: false, reason }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  return [];
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return String(dateStr);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let token = "";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      token = String((body as { token?: unknown })?.token || "");
    } else {
      token = new URL(req.url).searchParams.get("token") || "";
    }
    if (!token) return json({ ok: false, reason: "missing_token" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // ── 1) Regular booking ──────────────────────────────────────────────
    const { data: b } = await supabase
      .from("bookings")
      .select(
        "id, first_name, service_date, address, city, status, before_photos, after_photos, cleaner_id, completed_at",
      )
      .eq("photo_view_token", token)
      .maybeSingle();

    if (b) {
      let cleanerFirstName: string | null = null;
      if (b.cleaner_id) {
        const { data: c } = await supabase
          .from("cleaners")
          .select("first_name")
          .eq("id", b.cleaner_id)
          .maybeSingle();
        cleanerFirstName = c?.first_name || null;
      }
      const dateLabel = formatDate(b.service_date);
      return json({
        ok: true,
        kind: "booking",
        title: dateLabel ? `Your clean on ${dateLabel}` : "Your clean",
        customerFirstName: b.first_name || null,
        serviceDate: b.service_date,
        addressLine: [b.address, b.city].filter(Boolean).join(", "),
        cleanerFirstName,
        completedAt: b.completed_at || null,
        beforePhotos: asArray(b.before_photos),
        afterPhotos: asArray(b.after_photos),
      });
    }

    // ── 2) Partner / STR turnover ───────────────────────────────────────
    const { data: t } = await supabase
      .from("turnover_requests")
      .select(
        "id, property_id, requested_date, status, before_photos, after_photos, assigned_cleaner_id, completed_at",
      )
      .eq("photo_view_token", token)
      .maybeSingle();

    if (t) {
      let propertyLabel = "your property";
      let addressLine = "";
      if (t.property_id) {
        const { data: p } = await supabase
          .from("properties")
          .select("nickname, address, city")
          .eq("id", t.property_id)
          .maybeSingle();
        propertyLabel = p?.nickname || p?.address || "your property";
        addressLine = [p?.address, p?.city].filter(Boolean).join(", ");
      }
      let cleanerFirstName: string | null = null;
      if (t.assigned_cleaner_id) {
        const { data: c } = await supabase
          .from("cleaners")
          .select("first_name")
          .eq("id", t.assigned_cleaner_id)
          .maybeSingle();
        cleanerFirstName = c?.first_name || null;
      }
      const dateLabel = formatDate(t.requested_date);
      return json({
        ok: true,
        kind: "turnover",
        title: `${propertyLabel}${dateLabel ? ` — ${dateLabel}` : ""}`,
        customerFirstName: null,
        serviceDate: t.requested_date,
        addressLine,
        cleanerFirstName,
        completedAt: t.completed_at || null,
        beforePhotos: asArray(t.before_photos),
        afterPhotos: asArray(t.after_photos),
      });
    }

    return json({ ok: false, reason: "not_found" }, 404);
  } catch (err) {
    return json({ ok: false, reason: "server_error", message: (err as Error).message }, 500);
  }
});
