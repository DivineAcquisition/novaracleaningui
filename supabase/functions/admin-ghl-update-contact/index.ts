// ─── admin-ghl-update-contact ──────────────────────────────────────────
//
// Reusable GHL contact upsert helper for the admin tooling. Pass an
// email/phone (or both) plus tags + customFieldsByKey, and it:
//   1. Loads the GHL location's custom-field map (cached per cold start)
//   2. Resolves caller-supplied field keys to GHL field UUIDs, dropping
//      any keys that don't exist so the upsert never 4xx's
//   3. Calls /contacts/upsert with the matched custom fields + tags
//   4. Returns what landed, what was skipped, and the GHL contact id.
//
// Custom field key lookup accepts either bare key ("bedrooms") or the
// fully-qualified GHL key ("contact.bedrooms") and the field's display
// name ("Bedrooms").

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BASE = "https://services.leadconnectorhq.com";
const VER = "2021-07-28";

async function ghl(path: string, init: RequestInit = {}) {
  const token = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Version: VER,
    Accept: "application/json",
    ...((init.headers as Record<string, string> | undefined) || {}),
  };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { ok: res.ok, status: res.status, body: json ?? text };
}

let fieldMap: Record<string, string> | null = null;
async function loadFieldMap(locationId: string): Promise<Record<string, string>> {
  if (fieldMap) return fieldMap;
  const map: Record<string, string> = {};
  try {
    const res = await ghl(`/locations/${encodeURIComponent(locationId)}/customFields`);
    if (!res.ok) { fieldMap = map; return map; }
    const fields = ((res.body as any)?.customFields || []) as Array<any>;
    for (const f of fields) {
      if (!f.id) continue;
      const rawKey = f.fieldKey || f.key || "";
      const bareKey = rawKey.split(".").pop() || rawKey;
      if (bareKey) map[bareKey] = f.id;
      if (rawKey) map[rawKey] = f.id;
      if (f.name) map[f.name] = f.id;
    }
  } catch (_) {}
  fieldMap = map;
  return map;
}

function buildCustomFields(
  byKey: Record<string, unknown> | undefined,
  fieldKeyMap: Record<string, string>,
) {
  const matched: Array<{ id: string; fieldKey: string; field_value: string }> = [];
  const skipped: Array<{ key: string; value: string }> = [];
  if (!byKey) return { matched, skipped };
  for (const [key, raw] of Object.entries(byKey)) {
    if (raw === undefined || raw === null || raw === "") continue;
    const id = fieldKeyMap[key] ?? fieldKeyMap[`contact.${key}`];
    if (!id) { skipped.push({ key, value: String(raw) }); continue; }
    matched.push({ id, fieldKey: key, field_value: String(raw) });
  }
  return { matched, skipped };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const locationId = (Deno.env.get("GHL_LOCATION_ID") || "").trim();
    if (!locationId) {
      return new Response(JSON.stringify({ error: "GHL_LOCATION_ID not set" }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const firstName = (body.firstName || "").toString().trim();
    const lastName = (body.lastName || "").toString().trim();
    const tagsToAdd: string[] = Array.isArray(body.tags)
      ? body.tags.map((t: unknown) => String(t).trim()).filter(Boolean)
      : [];
    const customFieldsByKey = body.customFieldsByKey || {};
    const source = (body.source || "admin chat mapping").toString();

    if (!email && !phone) {
      return new Response(JSON.stringify({ error: "email or phone required" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const fieldKeyMap = await loadFieldMap(locationId);
    const cf = buildCustomFields(customFieldsByKey, fieldKeyMap);

    const upsertBody: Record<string, unknown> = {
      locationId,
      email: email || undefined,
      phone: phone || undefined,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      source,
      tags: tagsToAdd.length > 0 ? tagsToAdd : undefined,
      customFields: cf.matched.length > 0
        ? cf.matched.map((m) => ({ id: m.id, field_value: m.field_value }))
        : undefined,
    };

    const upsert = await ghl("/contacts/upsert", {
      method: "POST",
      body: JSON.stringify(upsertBody),
    });
    if (!upsert.ok) {
      return new Response(JSON.stringify({
        ...upsert, ok: false, stage: "upsert", custom_fields_attempted: cf,
      }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const contact = (upsert.body as any)?.contact || upsert.body || {};
    return new Response(JSON.stringify({
      ok: true,
      contactId: contact.id || null,
      isNew: (upsert.body as any)?.new ?? null,
      tags_applied: tagsToAdd,
      custom_fields_applied: cf.matched.map((m) => ({ key: m.fieldKey, value: m.field_value })),
      custom_fields_skipped: cf.skipped,
      ghl_field_map_size: Object.keys(fieldKeyMap).length,
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
