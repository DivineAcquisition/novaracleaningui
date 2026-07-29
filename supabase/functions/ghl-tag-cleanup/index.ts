// ─── ghl-tag-cleanup ─────────────────────────────────────────────────────────
//
// Undoes the tag sprawl. Walks every GHL contact, works out which of its tags
// the policy in _shared/ghl-tags.ts actually recognizes, and removes the rest —
// then optionally deletes the now-orphaned tag definitions from the location so
// they stop appearing in GHL's tag picker and tempting people to reuse them.
//
// DRY RUN BY DEFAULT. `{ apply: true }` is required to change anything, because
// the first thing anyone sensibly wants is a list of what WOULD be removed.
//
// Body:
//   { apply?: boolean          — false (default) reports only
//     limit?: number           — max contacts to walk (default 2000)
//     deleteLocationTags?: boolean — also remove orphaned tag definitions
//     sample?: number }        — how many example contacts to return (default 25)
//
// Admin/VA JWT or the service-role key. Never throws; partial progress is
// reported rather than lost, because a rate limit halfway through a few
// thousand contacts shouldn't cost you the whole run.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { enforceTagPolicy, MAX_TAGS_PER_CONTACT, vocabularySummary } from "../_shared/ghl-tags.ts";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const log = (s: string, d?: unknown) =>
  console.log(`[ghl-tag-cleanup] ${s}${d ? ` ${JSON.stringify(d)}` : ""}`);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

interface Cfg {
  token: string;
  locationId: string;
}

// deno-lint-ignore no-explicit-any
async function resolveSecret(supabase: any, name: string): Promise<string> {
  let v = (Deno.env.get(name) || "").trim();
  if (v) return v;
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    v = String(data?.value || "").trim();
  } catch { /* env-only install */ }
  return v;
}

async function ghl(cfg: Cfg, path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    Version: GHL_VERSION,
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  // One retry on a rate limit: a sweep across thousands of contacts will hit
  // 429 eventually and abandoning the run there loses all the progress.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${GHL_BASE}${path}`, { ...init, headers });
    if (res.status !== 429 && res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return await fetch(`${GHL_BASE}${path}`, { ...init, headers });
}

interface GhlContact {
  id: string;
  email?: string | null;
  phone?: string | null;
  contactName?: string | null;
  tags?: string[];
}

/** Page through the location's contacts. GHL caps page size at 100. */
async function* walkContacts(cfg: Cfg, limit: number): AsyncGenerator<GhlContact> {
  let page = 1;
  let seen = 0;
  while (seen < limit) {
    const res = await ghl(
      cfg,
      `/contacts/?locationId=${encodeURIComponent(cfg.locationId)}&limit=100&page=${page}`,
    );
    if (!res.ok) {
      log("contact page failed", { page, status: res.status });
      return;
    }
    const body = (await res.json()) as { contacts?: GhlContact[] };
    const batch = body.contacts || [];
    if (batch.length === 0) return;
    for (const c of batch) {
      if (seen >= limit) return;
      seen += 1;
      yield c;
    }
    if (batch.length < 100) return;
    page += 1;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // ── Auth: admin/VA JWT, or the service role for a scripted run ───────────
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let actor = "service-role";
  if (!jwt) return json({ error: "Not signed in." }, 401);
  if (jwt !== serviceKey) {
    try {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: `Bearer ${jwt}` } } },
      );
      const { data: u } = await userClient.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return json({ error: "Not signed in." }, 401);
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
      if (!allowed) return json({ error: "Admins or VAs only." }, 403);
      actor = u?.user?.email || uid;
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Auth failed." }, 403);
    }
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const apply = body.apply === true;
  const limit = Math.min(20_000, Math.max(1, Number(body.limit) || 2000));
  const sampleSize = Math.min(200, Math.max(0, Number(body.sample) ?? 25));
  const deleteLocationTags = body.deleteLocationTags === true;

  const cfg: Cfg = {
    token: await resolveSecret(supabase, "GHL_PIT_TOKEN"),
    locationId: await resolveSecret(supabase, "GHL_LOCATION_ID"),
  };
  if (!cfg.token || !cfg.locationId) {
    return json({ error: "GHL is not configured (GHL_PIT_TOKEN / GHL_LOCATION_ID)." }, 500);
  }

  const startedAt = new Date().toISOString();
  let scanned = 0;
  let contactsChanged = 0;
  let tagsRemoved = 0;
  let failures = 0;
  // How often each non-vocabulary tag appears — the actual answer to "what
  // junk is in here", which is more useful than a per-contact dump.
  const offenders = new Map<string, number>();
  const sample: {
    contactId: string;
    who: string;
    before: string[];
    after: string[];
    removed: string[];
  }[] = [];

  try {
    for await (const contact of walkContacts(cfg, limit)) {
      scanned += 1;
      const before = Array.isArray(contact.tags) ? contact.tags.map(String) : [];
      if (before.length === 0) continue;

      const policy = enforceTagPolicy(before);
      const keep = new Set(policy.tags);
      // Compare on the RAW strings: the policy may rename a tag ("membership-
      // paused" → "member - paused"), in which case the old spelling has to go
      // and the new one has to be added.
      const toRemove = before.filter((t) => !keep.has(t));
      const toAdd = policy.tags.filter((t) => !before.includes(t));

      for (const d of policy.dropped) {
        offenders.set(d.tag, (offenders.get(d.tag) || 0) + 1);
      }

      if (toRemove.length === 0 && toAdd.length === 0) continue;

      if (sample.length < sampleSize) {
        sample.push({
          contactId: contact.id,
          who: contact.email || contact.phone || contact.contactName || contact.id,
          before,
          after: policy.tags,
          removed: toRemove,
        });
      }

      if (!apply) {
        contactsChanged += 1;
        tagsRemoved += toRemove.length;
        continue;
      }

      let ok = true;
      if (toRemove.length > 0) {
        const res = await ghl(cfg, `/contacts/${encodeURIComponent(contact.id)}/tags`, {
          method: "DELETE",
          body: JSON.stringify({ tags: toRemove }),
        });
        ok = res.ok && ok;
      }
      if (toAdd.length > 0) {
        const res = await ghl(cfg, `/contacts/${encodeURIComponent(contact.id)}/tags`, {
          method: "POST",
          body: JSON.stringify({ tags: toAdd }),
        });
        ok = res.ok && ok;
      }
      if (ok) {
        contactsChanged += 1;
        tagsRemoved += toRemove.length;
      } else {
        failures += 1;
      }
    }
  } catch (e) {
    log("sweep aborted", { message: e instanceof Error ? e.message : String(e), scanned });
  }

  // ── Orphaned tag definitions in the location's tag list ──────────────────
  // Removing a tag from every contact leaves the definition behind in GHL's
  // picker, which is how a retired tag gets reused six months later.
  let locationTagsChecked = 0;
  let locationTagsDeleted = 0;
  const locationTagsToDelete: string[] = [];
  try {
    const res = await ghl(cfg, `/locations/${encodeURIComponent(cfg.locationId)}/tags`);
    if (res.ok) {
      const parsed = (await res.json()) as { tags?: { id?: string; name?: string }[] };
      const all = parsed.tags || [];
      locationTagsChecked = all.length;
      for (const t of all) {
        const name = String(t?.name || "");
        if (!name) continue;
        if (enforceTagPolicy([name]).tags.length > 0) continue;
        locationTagsToDelete.push(name);
        if (apply && deleteLocationTags && t.id) {
          const del = await ghl(
            cfg,
            `/locations/${encodeURIComponent(cfg.locationId)}/tags/${encodeURIComponent(t.id)}`,
            { method: "DELETE" },
          );
          if (del.ok) locationTagsDeleted += 1;
        }
      }
    } else {
      log("location tag list unavailable", { status: res.status });
    }
  } catch (e) {
    log("location tag sweep failed", { message: e instanceof Error ? e.message : String(e) });
  }

  const topOffenders = [...offenders.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([tag, count]) => ({ tag, contacts: count }));

  const result = {
    ok: true,
    mode: apply ? "applied" : "dry run",
    startedAt,
    finishedAt: new Date().toISOString(),
    actor,
    maxTagsPerContact: MAX_TAGS_PER_CONTACT,
    scanned,
    contactsChanged,
    tagsRemoved,
    failures,
    topOffenders,
    locationTags: {
      checked: locationTagsChecked,
      offVocabulary: locationTagsToDelete.length,
      names: locationTagsToDelete.slice(0, 100),
      deleted: locationTagsDeleted,
    },
    sample,
    vocabulary: vocabularySummary(),
  };

  log("done", {
    mode: result.mode,
    scanned,
    contactsChanged,
    tagsRemoved,
    offVocabularyDefinitions: locationTagsToDelete.length,
  });

  await supabase
    .from("events")
    .insert({
      event_type: "ghl.tag_cleanup",
      source: "ghl-tag-cleanup",
      summary:
        `🏷 GHL tag cleanup (${result.mode}) by ${actor} — scanned ${scanned} contacts, ` +
        `${apply ? "cleaned" : "would clean"} ${contactsChanged} of them, ` +
        `${apply ? "removed" : "would remove"} ${tagsRemoved} tags. ` +
        `${locationTagsToDelete.length} tag definitions are outside the vocabulary` +
        `${apply && deleteLocationTags ? ` (${locationTagsDeleted} deleted)` : ""}.`,
      data: {
        mode: result.mode,
        scanned,
        contacts_changed: contactsChanged,
        tags_removed: tagsRemoved,
        failures,
        top_offenders: topOffenders.slice(0, 25),
        location_tags_off_vocabulary: locationTagsToDelete.slice(0, 50),
        location_tags_deleted: locationTagsDeleted,
      },
    })
    .then(() => undefined, () => undefined);

  return json(result);
});
