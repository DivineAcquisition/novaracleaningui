import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  createHostOnboardingOpportunity,
  markHostAgreementSigned,
  sendHostAgreement,
  upsertHostOnboardingContact,
} from "../_shared/host-onboarding-ghl.ts";

// ─── partner-host-onboarding — GHL side of the host onboarding flow ───────
//
// Invoked server-to-server by the Next.js orchestrator routes (which own the
// DB + Airtable writes). Service-role authenticated only. Three actions:
//
//   submit           -> upsert contact + custom fields + opportunity (§3.1)
//   sendForSignature -> trigger the correct document template (§3.2 / §4 / §5.3)
//   markSigned       -> stamp Signed + Active on signature webhook (§5.4)

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Only the trusted internal orchestrator (service-role bearer) may call this.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!serviceRoleKey || jwt !== serviceRoleKey) {
    return json({ error: "Forbidden" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = String(body.action || "");

  try {
    if (action === "submit") {
      const contactId = await upsertHostOnboardingContact({
        fullName: String(body.fullName || ""),
        email: String(body.email || ""),
        phone: String(body.phone || ""),
        entityType: body.entityType === "entity" ? "entity" : "individual",
        entityName: body.entityName ? String(body.entityName) : undefined,
        serviceZone: body.serviceZone ? String(body.serviceZone) : undefined,
        propertyCount: Number(body.propertyCount || 0),
      });
      let opportunityId: string | null = null;
      if (contactId) {
        opportunityId = await createHostOnboardingOpportunity(contactId, {
          fullName: String(body.fullName || ""),
          email: String(body.email || ""),
        });
      }
      return json({ ok: true, contactId, opportunityId });
    }

    if (action === "sendForSignature") {
      const ok = await sendHostAgreement({
        contactId: String(body.contactId || ""),
        email: String(body.email || ""),
        entityType: body.entityType === "entity" ? "entity" : "individual",
        entityName: body.entityName ? String(body.entityName) : undefined,
        rateSummary: body.rateSummary ? String(body.rateSummary) : undefined,
        opportunityId: body.opportunityId ? String(body.opportunityId) : null,
      });
      return json({ ok });
    }

    if (action === "markSigned") {
      const ok = await markHostAgreementSigned({
        contactId: body.contactId ? String(body.contactId) : null,
        email: String(body.email || ""),
        opportunityId: body.opportunityId ? String(body.opportunityId) : null,
      });
      return json({ ok });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
