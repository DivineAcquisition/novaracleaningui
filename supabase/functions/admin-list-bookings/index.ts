// admin-list-bookings
//
// Admin/VA booking list with server-side filters + search.

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

// Only columns that exist on public.bookings (service_duration is not a DB column).
const SELECT_COLS =
  "id, booking_number, status, service_type, home_size_id, service_date, time_slot, first_name, last_name, email, phone, address, city, state, zip_code, total_estimate_cents, deposit_cents, final_charge_cents, payment_intent_id, cleaner_id, job_id, num_cleaners_assigned, estimated_duration_hours, created_at, uses_credit, cancel_reason, add_ons, membership_plan, hosted_invoice_url, suppress_review_request";

function matchesSearch(row: Record<string, unknown>, term: string): boolean {
  const q = term.toLowerCase();
  const digits = q.replace(/\D/g, "");
  const fields = [
    row.first_name,
    row.last_name,
    row.email,
    row.phone,
    row.address,
    row.city,
    row.zip_code,
    row.service_date,
    row.service_type,
    row.booking_number,
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
  if (fields.some((f) => f.includes(q))) return true;
  if (digits && String(row.phone || "").replace(/\D/g, "").includes(digits)) return true;
  return false;
}

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

    const buildQuery = (cols: string) => {
      let q = admin.from("bookings").select(cols, { count: "exact" });
      if (status !== "all") q = q.eq("status", status);
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
      return q
        .order("service_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);
    };

    let { data, error, count } = await buildQuery(SELECT_COLS);
    if (error && /suppress_review_request/i.test(error.message || "")) {
      console.warn("[admin-list-bookings] suppress_review_request missing — legacy select");
      ({ data, error, count } = await buildQuery(SELECT_COLS_LEGACY));
    }

    if (error) {
      console.error("[admin-list-bookings] query error", error);
      throw error;
    }

    let rows = (data || []) as Record<string, unknown>[];
    if (search.length >= 1) {
      rows = rows.filter((row) => matchesSearch(row, search));
    }

    return json({
      success: true,
      bookings: rows,
      total: search.length >= 1 ? rows.length : (count ?? rows.length),
      limit,
      filters: { search, status, dateRange },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-list-bookings]", msg);
    return json({ error: msg }, 500);
  }
});
