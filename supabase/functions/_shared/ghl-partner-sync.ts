// ─── Partner Turnover Portal → GoHighLevel sync ───────────────────────────
//
// The Turnover Request Portal (partner.novaracleaning.com) shipped without
// any GHL integration: hosts never became CRM contacts and turnover jobs
// never appeared as opportunities, so the team had no pipeline visibility
// and none of the GHL-driven comms/automation fired.
//
// This helper bridges that gap, reusing the same battle-tested ghl-client
// plumbing the customer funnel uses. Everything is best-effort + never
// throws — a CRM hiccup can never break a host's booking. Resolved ids are
// persisted back onto public.hosts / public.turnover_requests so repeat
// events PATCH the same records instead of spawning pipeline duplicates.

import {
  createOpportunity,
  ghlIsConfigured,
  updateOpportunity,
  upsertContact,
  type GhlContactInput,
} from "./ghl-client.ts";
import { hostIdentityFields, turnoverCustomFields } from "./ghl-partner-field-map.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

const log = (step: string, details?: unknown) => {
  const tail = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  console.log(`[GHL-PARTNER] ${step}${tail}`);
};

export interface HostLike {
  id?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  ghl_contact_id?: string | null;
}

export interface PropertyLike {
  nickname?: string | null;
  address?: string | null;
  access_instructions?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
}

export interface TurnoverLike {
  id?: string;
  requested_date?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  price?: number | null;
  status?: string | null;
  notes?: string | null;
  ghl_contact_id?: string | null;
  ghl_opportunity_id?: string | null;
}

export interface CleanerLike {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

function splitName(name?: string | null): { firstName?: string; lastName?: string } {
  const n = (name || "").trim();
  if (!n) return {};
  const parts = n.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || undefined };
}

function fmtTime(t?: string | null): string {
  if (!t) return "";
  const [h, m] = String(t).split(":");
  const hh = parseInt(h, 10);
  if (Number.isNaN(hh)) return "";
  const ap = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${m ?? "00"} ${ap}`;
}

function fmtWindow(start?: string | null, end?: string | null): string {
  const a = fmtTime(start), b = fmtTime(end);
  if (a && b) return `${a} - ${b}`;
  return a || b || "";
}

function hostContactInput(
  host: HostLike,
  extraTags: string[] = [],
  customFieldsByKey?: GhlContactInput["customFieldsByKey"],
): GhlContactInput {
  const { firstName, lastName } = splitName(host.name);
  // Always stamp the STR-host identity fields so a turnover-only host matches
  // an onboarded host in GHL (consistency with the onboarding contact upsert).
  const mergedFields = { ...hostIdentityFields({}), ...(customFieldsByKey || {}) };
  return {
    email: host.email || undefined,
    phone: host.phone || undefined,
    firstName,
    lastName,
    name: host.name || undefined,
    source: "Novara Partner Portal",
    tags: ["partner", "partner - host", "source - turnover portal", ...extraTags],
    mergeTags: true,
    customFieldsByKey: mergedFields,
  };
}

/**
 * Upsert a partner host as a GHL contact and persist the resolved id back
 * onto public.hosts. Safe to call repeatedly (GHL upsert dedupes on email
 * or phone). Returns the contact id or null.
 */
export async function upsertHostContact(
  admin: SB,
  host: HostLike,
): Promise<string | null> {
  if (!ghlIsConfigured()) {
    log("skipped — GHL not configured");
    return null;
  }
  if (!host?.email && !host?.phone) {
    log("skipped — host has no email or phone", { hostId: host?.id });
    return null;
  }
  const contactId = await upsertContact(hostContactInput(host));
  if (contactId && host.id && contactId !== host.ghl_contact_id) {
    try {
      await admin.from("hosts").update({ ghl_contact_id: contactId }).eq("id", host.id);
    } catch (err) {
      log("persist host contact id failed (non-blocking)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return contactId;
}

function turnoverOpportunityStatus(
  status?: string | null,
): "open" | "won" | "lost" | "abandoned" {
  switch ((status || "").toLowerCase()) {
    case "completed":
      return "won";
    case "cancelled":
      return "lost";
    default:
      return "open";
  }
}

/**
 * Sync a turnover request into GHL as one opportunity on the host contact.
 * Creates the opportunity the first time and PATCHES it (status, value,
 * service window, assigned cleaner) on every subsequent lifecycle event.
 * Persists ghl_contact_id + ghl_opportunity_id onto the turnover row.
 */
export async function syncTurnoverToGhl(
  admin: SB,
  args: {
    host: HostLike;
    property: PropertyLike | null;
    turnover: TurnoverLike;
    cleaner?: CleanerLike | null;
  },
): Promise<{ contactId: string | null; opportunityId: string | null }> {
  if (!ghlIsConfigured()) {
    log("turnover sync skipped — GHL not configured");
    return { contactId: null, opportunityId: null };
  }

  const { host, property, turnover, cleaner } = args;

  // 0. Re-hydrate any GHL ids already persisted on the turnover row so a
  // follow-up lifecycle event (paid → assigned → completed) PATCHes the
  // same opportunity instead of creating a duplicate. Callers often pass a
  // row snapshotted before the previous sync persisted these ids.
  if (turnover.id && !turnover.ghl_opportunity_id) {
    try {
      const { data } = await admin
        .from("turnover_requests")
        .select("ghl_contact_id, ghl_opportunity_id")
        .eq("id", turnover.id)
        .maybeSingle();
      if (data) {
        turnover.ghl_opportunity_id = data.ghl_opportunity_id;
        turnover.ghl_contact_id = data.ghl_contact_id;
        if (!host.ghl_contact_id && data.ghl_contact_id) {
          host.ghl_contact_id = data.ghl_contact_id;
        }
      }
    } catch (_) { /* best-effort */ }
  }

  // 1. Resolve the host contact (reuse stored id, else upsert).
  const contactId = host.ghl_contact_id || turnover.ghl_contact_id ||
    (await upsertHostContact(admin, host));
  if (!contactId) {
    log("turnover sync skipped — no host contact", { turnoverId: turnover.id });
    return { contactId: null, opportunityId: null };
  }

  // 2. Build the opportunity payload.
  const priceNum = Number(turnover.price || 0);
  const propLabel = property?.nickname || property?.address || "Property";
  const dateLabel = turnover.requested_date || "";
  const windowLabel = fmtWindow(turnover.window_start, turnover.window_end);
  const serviceWhen = [dateLabel, windowLabel].filter(Boolean).join(" ");
  const cleanerName = [cleaner?.first_name, cleaner?.last_name]
    .filter(Boolean)
    .join(" ");

  const status = turnoverOpportunityStatus(turnover.status);
  const name = `Turnover — ${propLabel}${dateLabel ? ` — ${dateLabel}` : ""}`;

  const customFieldsByKey = turnoverCustomFields({
    serviceWhen,
    dateLabel,
    status,
    accessNotes: property?.access_instructions,
    jobNotes: turnover.notes,
    bedrooms: property?.bedrooms,
    bathrooms: property?.bathrooms,
    sqft: property?.sqft,
    priceDollars: priceNum,
    isPaid: !!turnover.status && turnover.status !== "pending_payment",
    cleanerName,
    cleanerPhone: cleaner?.phone,
  });

  const monetaryValue = priceNum > 0 ? Math.round(priceNum) : undefined;

  // 3. Update the existing opportunity, else create one.
  let opportunityId = turnover.ghl_opportunity_id || null;
  if (opportunityId) {
    const ok = await updateOpportunity(opportunityId, {
      name,
      status,
      monetaryValue,
      customFieldsByKey,
    });
    if (!ok) {
      log("turnover opportunity update failed — recreating", { opportunityId });
      opportunityId = null;
    }
  }

  if (!opportunityId) {
    opportunityId = await createOpportunity({
      contactId,
      name,
      status,
      monetaryValue,
      source: "Novara Partner Portal",
      customFieldsByKey,
    });
  }

  // 4. Persist resolved ids back onto the turnover row.
  if (turnover.id && (opportunityId || contactId)) {
    try {
      await admin
        .from("turnover_requests")
        .update({
          ghl_contact_id: contactId,
          ghl_opportunity_id: opportunityId,
        })
        .eq("id", turnover.id);
    } catch (err) {
      log("persist turnover ids failed (non-blocking)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log("turnover synced", { turnoverId: turnover.id, contactId, opportunityId, status });
  return { contactId, opportunityId };
}
