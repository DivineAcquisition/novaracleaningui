// ─── admin-ghl-list-fields ─────────────────────────────────────────────
//
// Enumerate every GHL custom field in the configured location with its
// id / name / fieldKey / dataType / model. Used as a discovery tool so
// admin tooling can map application data to the *actual* field keys
// rather than guessed ones.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const token = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
  const locationId = (Deno.env.get("GHL_LOCATION_ID") || "").trim();
  const res = await fetch(
    `https://services.leadconnectorhq.com/locations/${encodeURIComponent(locationId)}/customFields`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        Accept: "application/json",
      },
    },
  );
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch (_) {}
  const fields = (body?.customFields || []) as Array<any>;
  const summary = fields
    .map((f) => ({
      id: f.id,
      name: f.name,
      fieldKey: f.fieldKey,
      dataType: f.dataType,
      model: f.model,
    }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return new Response(JSON.stringify({ count: summary.length, fields: summary }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
