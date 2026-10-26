// Live caller context for Telnyx assistants.
//
// Telnyx POSTs assistant.initialization at the start of a call or text.
// The response is the caller's current Supabase record: name, address,
// bookings, lead details, and whether their ZIP is served.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, telnyx-signature-ed25519, telnyx-timestamp",
};

function toE164(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function last10(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function text(value: unknown): string {
  return value == null || value === "" ? "" : String(value);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let body: any = {};
  try { body = await req.json(); } catch { /* allow a manual test */ }
  const payload = body?.data?.payload || body?.payload || body || {};
  const phone = toE164(payload.telnyx_end_user_target || payload.phone || "");
  const ten = last10(phone);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let bookings: any[] = [];
  let lead: any = null;
  if (ten.length === 10) {
    const { data } = await supabase
      .from("bookings")
      .select("id, booking_number, status, first_name, last_name, email, phone, address, city, state, zip_code, service_date, time_slot, service_type, total_estimate_cents, final_charge_cents, deposit_cents, payment_received_at")
      .ilike("phone", `%${ten}%`)
      .order("created_at", { ascending: false })
      .limit(8);
    bookings = (data || []).filter((row: any) => last10(String(row.phone || "")) === ten);
    const { data: leadRow } = await supabase
      .from("leads")
      .select("first_name, last_name, email, phone, source, zip_code, city, state, service_type, bedrooms, bathrooms, sqft, preferred_date, do_not_call, created_at")
      .ilike("phone", `%${ten}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (leadRow && last10(String(leadRow.phone || "")) === ten) lead = leadRow;
  }

  const newest = bookings[0];
  const zip = String(payload.zip_code || newest?.zip_code || lead?.zip_code || "").replace(/\D/g, "").slice(0, 5);
  let coverage: any = null;
  let zoneName = "";
  let lookupFailed = false;
  if (zip) {
    const { data, error } = await supabase
      .from("service_coverage_zones")
      .select("city, state, county, tier, tier_label, is_active")
      .eq("zip_code", zip)
      .maybeSingle();
    if (error) lookupFailed = true;
    coverage = data;
    const { data: zoneZip } = await supabase.from("pricing_zone_zips").select("zone_id").eq("zip", zip).maybeSingle();
    if (zoneZip?.zone_id) {
      const { data: zone } = await supabase.from("pricing_zones").select("name, status").eq("id", zoneZip.zone_id).maybeSingle();
      if (zone?.status === "not_served") coverage = coverage ? { ...coverage, is_active: false } : coverage;
      zoneName = zone?.name || "";
    }
  }

  const active = bookings.filter((row) => ["pending_payment", "confirmed", "assigned"].includes(row.status));
  const next = active.find((row) => row.service_date) || active[0];
  const outstanding = active.reduce((sum, row) => {
    if (row.payment_received_at) return sum;
    return sum + Math.max(0, (row.final_charge_cents || row.total_estimate_cents || 0) - (row.deposit_cents || 0));
  }, 0);
  const firstName = text(newest?.first_name || lead?.first_name);
  const serviced = lookupFailed ? "unknown" : coverage ? (coverage.is_active ? "yes" : "no") : (zip ? "no" : "unknown");
  const nextBooking = next
    ? `Booking ${next.booking_number || ""} is ${next.status} on ${next.service_date || "an open date"} at ${next.time_slot || "a time still to be set"}, ${next.address || ""} ${next.city || ""}.`
    : "No active booking.";
  const brief = [
    firstName ? `The caller's name on file is ${firstName} ${text(newest?.last_name || lead?.last_name)}.` : "No name is on file yet.",
    newest?.address ? `Address on file: ${newest.address}, ${newest.city || ""} ${newest.state || ""} ${newest.zip_code || ""}.` : "",
    zip ? `ZIP ${zip} serviced: ${serviced}. ${coverage?.city || ""} ${coverage?.state || ""} ${zoneName}.` : "No ZIP is on file yet.",
    nextBooking,
    outstanding > 0 ? `Unpaid balance on file: ${money(outstanding)}.` : "No unpaid balance is on file.",
    lead?.source ? `Latest lead source: ${lead.source}.` : "",
    lead?.do_not_call ? "This lead is marked do not call." : "",
  ].filter(Boolean).join(" ");

  return new Response(JSON.stringify({
    dynamic_variables: {
      customer_found: bookings.length ? "yes" : "no",
      first_name: firstName || "there",
      customer_name: `${firstName} ${text(newest?.last_name || lead?.last_name)}`.trim(),
      customer_email: text(newest?.email || lead?.email),
      customer_address: text(newest?.address || ""),
      known_zip: zip,
      zip_serviced: serviced,
      coverage_city: text(coverage?.city),
      coverage_state: text(coverage?.state),
      pricing_zone: zoneName,
      next_booking: nextBooking,
      outstanding_balance: outstanding > 0 ? money(outstanding) : "none",
      lead_source: text(lead?.source || payload.lead_source),
      do_not_call: lead?.do_not_call ? "yes" : "no",
      context_brief: brief,
    },
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
