import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

// customer-manage-recurring
//
// Customer self-service for their own recurring cleaning plan (from the member
// portal). Authenticates the caller and only allows acting on a schedule whose
// email matches the signed-in user. Actions:
//   get               -> { schedule, upcoming }
//   pause / resume     -> toggle active
//   skip_next          -> advance next_service_date by one cycle
//   set_time           -> change preferred_time_slot
//   request_new_cleaner-> clear preferred cleaner + flag for admin (the
//                         "unless the customer requests a new one" rule)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function advance(date: string, cadence: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else if (cadence === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 14);
  return ymd(d);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Not signed in" }, 401);
    const token = auth.replace(/^Bearer\s+/i, "");
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: u } = await userClient.auth.getUser(token);
    const email = u?.user?.email?.toLowerCase();
    if (!email) return json({ error: "Not signed in" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "get");

    const { data: sched } = await admin
      .from("customer_recurring_schedules")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (action === "get") {
      let upcoming: unknown[] = [];
      if (sched) {
        const { data } = await admin
          .from("bookings")
          .select("id, service_date, time_slot, status, service_type, cleaner_id")
          .eq("recurring_schedule_id", sched.id)
          .gte("service_date", ymd(new Date()))
          .order("service_date", { ascending: true })
          .limit(6);
        upcoming = data || [];
      }
      return json({ schedule: sched || null, upcoming });
    }

    if (!sched) return json({ error: "No recurring plan found" }, 404);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (action === "pause") patch.active = false;
    else if (action === "resume") patch.active = true;
    else if (action === "skip_next") {
      if (!sched.next_service_date) return json({ error: "No upcoming clean to skip" }, 400);
      patch.next_service_date = advance(sched.next_service_date, sched.cadence);
    } else if (action === "set_time") {
      if (!body?.preferred_time_slot) return json({ error: "preferred_time_slot required" }, 400);
      patch.preferred_time_slot = String(body.preferred_time_slot);
    } else if (action === "request_new_cleaner") {
      patch.preferred_cleaner_id = null;
      patch.notes = `Customer requested a different cleaner on ${new Date().toISOString().slice(0, 10)}. Admin: assign a new regular cleaner.`;
    } else {
      return json({ error: `Unknown action: ${action}` }, 400);
    }

    const { error } = await admin.from("customer_recurring_schedules").update(patch).eq("id", sched.id);
    if (error) return json({ error: error.message }, 400);
    return json({ success: true, action });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
