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
import { getContractorChecklist } from "../_shared/contractor-checklists.ts";
import {
  labeledZonePhotos,
  parseSiteZones,
  parseZoneCompletions,
} from "../_shared/site-zones.ts";

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

    // Commercial identity. portal_user_id is the authoritative link, set when
    // the client creates their login during onboarding. Email matching stays
    // as a fallback for accounts provisioned before that column existed —
    // and because the person signing is very often not the address on the
    // account, matching on email alone was never something we could rely on.
    let account: Record<string, unknown> | null = null;
    const { data: byUserId } = await admin
      .from("business_accounts")
      .select("*")
      .eq("portal_user_id", user.id)
      .neq("status", "offboarded")
      .maybeSingle();
    account = byUserId || null;

    if (!account) {
      const { data: byEmail } = await admin
        .from("business_accounts")
        .select("*")
        .ilike("email", user.email)
        .neq("status", "offboarded")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      account = byEmail || null;
    }

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
        .select("id, nickname, address, city, facility_type, sqft, photo_zones")
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

      const siteRows = sites || [];
      const siteIds = siteRows.map((s: { id: string }) => s.id).filter(Boolean);
      const lastBySite = new Map<string, {
        bookingId: string;
        jobId: string | null;
        serviceDate: string | null;
        serviceType: string | null;
        scopeLevel: string | null;
        photoZones: unknown;
      }>();
      if (siteIds.length) {
        const { data: visits } = await admin
          .from("bookings")
          .select("id, job_id, business_site_id, service_date, status, service_type, scope_level, photo_zones")
          .in("business_site_id", siteIds)
          .in("status", ["completed", "pending_review"])
          .order("service_date", { ascending: false })
          .limit(80);
        for (const v of visits || []) {
          const sid = String(v.business_site_id || "");
          if (!sid || lastBySite.has(sid)) continue;
          lastBySite.set(sid, {
            bookingId: v.id,
            jobId: v.job_id || null,
            serviceDate: v.service_date || null,
            serviceType: v.service_type || null,
            scopeLevel: v.scope_level || null,
            photoZones: v.photo_zones,
          });
        }
      }
      const jobIds = [...lastBySite.values()].map((v) => v.jobId).filter(Boolean) as string[];
      const checklistsByJob = new Map<string, { section_meta?: unknown; zone_completion?: unknown }>();
      if (jobIds.length) {
        const { data: cls } = await admin
          .from("job_checklists")
          .select("job_id, section_meta, zone_completion")
          .in("job_id", jobIds);
        for (const cl of cls || []) {
          checklistsByJob.set(String(cl.job_id), cl);
        }
      }

      const sitesOut = siteRows.map((st: Record<string, unknown>) => {
        const map = parseSiteZones(st.photo_zones);
        const last = lastBySite.get(String(st.id));
        const cl = last?.jobId ? checklistsByJob.get(last.jobId) : null;
        const completions = parseZoneCompletions(cl?.zone_completion);
        const zoneNames = map.map((z) => z.name);
        const spec = zoneNames.length
          ? getContractorChecklist(
            String(last?.serviceType || "commercial"),
            [],
            undefined,
            { scopeLevel: last?.scopeLevel || "standard", photoZones: zoneNames },
          )
          : null;
        const photos = spec
          ? labeledZonePhotos(
            (cl?.section_meta || {}) as Record<string, { before?: string[]; after?: string[] }>,
            spec.sections,
          )
          : [];
        return {
          id: st.id,
          nickname: st.nickname,
          address: st.address,
          city: st.city,
          facility_type: st.facility_type,
          sqft: st.sqft,
          last_visit: last?.serviceDate || null,
          zones: map.map((z) => {
            const done = completions.find((c) => c.name.toLowerCase() === z.name.toLowerCase());
            const zPhotos = photos.filter((p) => p.zoneName.toLowerCase() === z.name.toLowerCase());
            return {
              id: z.id,
              name: z.name,
              description: z.description,
              status: done?.status || null,
              note: done?.note || "",
              before: zPhotos.filter((p) => p.kind === "before").map((p) => p.url),
              after: zPhotos.filter((p) => p.kind === "after").map((p) => p.url),
            };
          }),
        };
      });

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
        sites: sitesOut,
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
