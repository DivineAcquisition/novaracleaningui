// Meta Conversions API. The access token lives in app_secrets
// (META_CAPI_ACCESS_TOKEN), never in the client. Purchase uses the
// booking id as event_id so it dedupes with the browser pixel.

import { resolveSecret } from "./app-secrets.ts";

const PIXEL_ID = "1641726577181415";

// deno-lint-ignore no-explicit-any
type SupabaseClientLike = { from: (table: string) => any };

async function sha256(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normPhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  return digits;
}

function fbcFromClick(fbclid: string, firstVisit: unknown): string {
  const parsed = typeof firstVisit === "string" ? Date.parse(firstVisit) : NaN;
  const ts = Number.isFinite(parsed) ? parsed : Date.now();
  return `fb.1.${ts}.${fbclid}`;
}

export async function sendMetaPurchase(
  supabase: SupabaseClientLike,
  booking: Record<string, unknown>,
  amountReceivedCents = 0,
): Promise<void> {
  const token = await resolveSecret(supabase, "META_CAPI_ACCESS_TOKEN");
  if (!token || !booking?.id) return;

  const estimate = Number(booking.total_estimate_cents || 0);
  const finalCharge = Number(booking.final_charge_cents || 0);
  const cents = estimate > 0 ? estimate : finalCharge > 0 ? finalCharge : amountReceivedCents;
  if (!Number.isFinite(cents) || cents <= 0) return;

  const userData: Record<string, unknown> = {};
  const email = String(booking.email || "").trim().toLowerCase();
  if (email.includes("@")) userData.em = [await sha256(email)];
  const phone = normPhone(String(booking.phone || ""));
  if (phone.length >= 11) userData.ph = [await sha256(phone)];

  const tracking = (booking.tracking && typeof booking.tracking === "object")
    ? booking.tracking as Record<string, unknown>
    : {};
  const fbp = typeof tracking.fbp === "string" ? tracking.fbp : "";
  if (fbp.startsWith("fb.")) userData.fbp = fbp;
  const fbclid = String(booking.fbclid || tracking.fbclid || "");
  if (fbclid) userData.fbc = fbcFromClick(fbclid, booking.first_visit_at || tracking.first_visit_timestamp);

  const source = typeof booking.landing_page === "string" && booking.landing_page.startsWith("http")
    ? booking.landing_page
    : "https://try.novaracleaning.com/book/confirmation";

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [{
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: String(booking.id),
          action_source: "website",
          event_source_url: source,
          user_data: userData,
          custom_data: {
            currency: "USD",
            value: Math.round(cents) / 100,
            content_name: String(booking.service_type || "cleaning"),
            order_id: String(booking.id),
          },
        }],
      }),
    },
  );
  const body = await res.text();
  if (!res.ok) {
    console.error("[meta-capi] Purchase failed", res.status, body.slice(0, 300));
    return;
  }
  console.log("[meta-capi] Purchase sent", String(booking.id), body.slice(0, 180));
}
