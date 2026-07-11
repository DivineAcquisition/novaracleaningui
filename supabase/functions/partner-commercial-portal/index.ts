// partner-commercial-portal
//
// Backs the commercial/office side of the partner portal
// (partner.novaracleaning.com). STR hosts already have the full turnover
// portal; this gives commercial & office partners their own least-visibility
// view — their account only, never other partners or admin tools.
//
// Auth: the logged-in partner's JWT (email is the identity key). Actions:
//   { action: "lookup" }          → { kind: 'host' | 'commercial' | 'none' }
//     Decides which portal surface to render WITHOUT side effects (the STR
//     dashboard's host.ensure creates host rows, so commercial users must be
//     routed before it runs).
//   { action: "overview" }        → account, setup gates (agreement +
//     payment), service bookings (their sites' visits), invoices, documents.
//   { action: "request_service" } → typed change/extra-service request →
//     lead + Discord alert to the team. Never prices.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}
const log = (m: string, d?: unknown) =>
  console.log(`[partner-commercial-portal] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

async function getUser(req: Request): Promise<{ id: string; email: string } | null> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data } = await userClient.auth.getUser();
  if (!data?.user?.id || !data.user.email) return null;
  return { id: data.user.id, email: data.user.email.toLowerCase() };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const user = await getUser(req);
    if (!user) return json({ ok: false, error: "Not signed in." }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "lookup");

    // Resolve identity: STR host first (user_id, then email), else commercial.
    const { data: hostById } = await admin.from("hosts").select("id").eq("user_id", user.id).maybeSingle();
    let isHost = Boolean(hostById?.id);
    if (!isHost) {
      const { data: hostByEmail } = await admin.from("hosts").select("id").ilike("email", user.email).maybeSingle();
      isHost = Boolean(hostByEmail?.id);
    }

    const { data: account } = await admin
      .from("business_accounts")
      .select("*")
      .ilike("email", user.email)
      .neq("status", "offboarded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (action === "lookup") {
      return json({
        ok: true,
        kind: isHost ? "host" : account ? "commercial" : "none",
      });
    }

    if (!account) return json({ ok: false, error: "No commercial account for this login." }, 404);

    if (action === "overview") {
      // Setup gates — nothing bookable until agreement signed + payment on file.
      const setupComplete = Boolean(account.agreement_signed_at) && Boolean(account.stripe_customer_id);

      const { data: bookings } = await admin
        .from("bookings")
        .select("id, booking_number, status, service_date, time_slot, arrival_window, address, city, state, business_name, facility_type, custom_quote_cents, final_charge_cents, total_estimate_cents, hosted_invoice_url, is_recurring, recurring_frequency, completed_at")
        .eq("business_account_id", account.id)
        .order("service_date", { ascending: false })
        .limit(100);

      const { data: sites } = await admin
        .from("business_sites")
        .select("id, nickname, address, city, facility_type, sqft")
        .eq("business_account_id", account.id)
        .eq("active", true)
        .order("created_at", { ascending: true });

      // Documents: signed agreements by email (bucket + DocuSeal).
      const { data: agreements } = await admin
        .from("service_agreements")
        .select("id, pdf_path, created_at, signed_by")
        .ilike("customer_email", user.email)
        .order("created_at", { ascending: false })
        .limit(5);
      const docs: Array<{ label: string; url: string | null; date: string }> = [];
      for (const a of agreements || []) {
        let url: string | null = null;
        if (a.pdf_path) {
          const { data: signed } = await admin.storage.from("service-agreements").createSignedUrl(a.pdf_path, 3600);
          url = signed?.signedUrl || null;
        }
        docs.push({ label: `Service agreement — signed ${String(a.created_at).slice(0, 10)}`, url, date: a.created_at });
      }
      const { data: docuseal } = await admin
        .from("docuseal_submissions")
        .select("id, audience, status, document_url, created_at")
        .ilike("submitter_email", user.email)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(5);
      for (const d of docuseal || []) {
        if (d.document_url) {
          docs.push({ label: `Signed agreement (${String(d.audience).replace(/_/g, " ")})`, url: d.document_url, date: d.created_at });
        }
      }

      return json({
        ok: true,
        account: {
          id: account.id,
          business_name: account.business_name,
          contact_name: account.contact_name,
          account_type: account.account_type,
          facility_type: account.facility_type,
          status: account.status,
          recurring_frequency: account.recurring_frequency,
          num_locations: account.num_locations,
          agreement_signed: Boolean(account.agreement_signed_at),
          payment_on_file: Boolean(account.stripe_customer_id),
          autopay_enabled: Boolean(account.autopay_enabled),
          setup_complete: setupComplete,
        },
        bookings: bookings || [],
        sites: sites || [],
        documents: docs,
      });
    }

    if (action === "request_service") {
      const message = String(body?.message || "").trim().slice(0, 2000);
      if (!message) return json({ ok: false, error: "Describe what you need." }, 400);
      const kind = String(body?.kind || "change_request").slice(0, 40);

      await admin.from("events").insert({
        event_type: "partner.lead.created",
        source: "partner-portal",
        summary: `📩 ${account.business_name} (${account.account_type}) — partner portal ${kind.replace(/_/g, " ")}:\n${message.slice(0, 500)}\nContact: ${account.contact_name || ""} · ${user.email}`,
        data: { business_account_id: account.id, kind, message },
      });
      await admin.from("business_accounts").update({ last_activity_at: new Date().toISOString() }).eq("id", account.id);
      return json({ ok: true });
    }

    return json({ ok: false, error: `Unknown action '${action}'` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
