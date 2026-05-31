// admin-list-bookings
//
// Admin/VA booking list with server-side filters + search so customers like
// "Maddie" are never hidden by client-side caps or calendar-week edge cases.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function localYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeekMonday(d = new Date()): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = copy.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  copy.setDate(copy.getDate() + diff);
  return localYmd(copy);
}

function endOfWeekSunday(d = new Date()): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = copy.getDay();
  const diff = dow === 0 ? 0 : 7 - dow;
  copy.setDate(copy.getDate() + diff);
  return localYmd(copy);
}

/** Mon–Sun this week; on Sat/Sun extend through next Sunday so Monday jobs appear. */
function thisWeekServiceRange(): { from: string; to: string } {
  const from = startOfWeekMonday();
  let to = endOfWeekSunday();
  const dow = new Date().getDay();
  if (dow === 0 || dow === 6) {
    const end = new Date();
    const diff = dow === 0 ? 0 : 7 - dow;
    end.setDate(end.getDate() + diff + 7);
    to = localYmd(end);
  }
  return { from, to };
}

async function ensureAdminOrVa(admin: ReturnType<typeof createClient>, jwt: string) {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
}

const SELECT_COLS =
  "id, booking_number, status, service_type, home_size_id, service_date, time_slot, first_name, last_name, email, phone, address, city, state, zip_code, total_estimate_cents, deposit_cents, final_charge_cents, payment_intent_id, cleaner_id, job_id, num_cleaners_assigned, estimated_duration_hours, created_at, uses_credit, cancel_reason, service_duration";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const search = String(body?.search || "").trim();
    const status = String(body?.status || "all").toLowerCase();
    const dateRange = String(body?.dateRange || "all").toLowerCase();
    const limit = Math.min(Math.max(Number(body?.limit) || 1000, 1), 2000);

    let q = admin.from("bookings").select(SELECT_COLS, { count: "exact" });

    if (status !== "all") {
      q = q.eq("status", status);
    }

    const today = localYmd();
    if (dateRange === "upcoming") {
      q = q.or(`service_date.gte.${today},service_date.is.null`);
    } else if (dateRange === "next_14") {
      const end = new Date();
      end.setDate(end.getDate() + 14);
      q = q.gte("service_date", today).lte("service_date", localYmd(end));
    } else if (dateRange === "this_week") {
      const { from, to } = thisWeekServiceRange();
      q = q.gte("service_date", from).lte("service_date", to);
    } else if (dateRange === "past_30") {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      q = q.gte("service_date", localYmd(past));
    } else if (dateRange === "last_7_created") {
      const past = new Date();
      past.setDate(past.getDate() - 7);
      q = q.gte("created_at", past.toISOString());
    }

    if (search.length >= 1) {
      const term = search.replace(/[%_,]/g, "").slice(0, 80);
      const ilike = `%${term}%`;
      q = q.or(
        [
          `first_name.ilike.${ilike}`,
          `last_name.ilike.${ilike}`,
          `email.ilike.${ilike}`,
          `phone.ilike.${ilike}`,
          `address.ilike.${ilike}`,
          `city.ilike.${ilike}`,
          `zip_code.ilike.${ilike}`,
          `service_date.ilike.${ilike}`,
        ].join(","),
      );
    }

    const { data, error, count } = await q
      .order("service_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return json({
      success: true,
      bookings: data || [],
      total: count ?? (data || []).length,
      limit,
      filters: { search, status, dateRange },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-list-bookings]", msg);
    return json({ error: msg }, 500);
  }
});
