// qc-reclean
//
// End-to-end Spotless Guarantee re-clean workflow attached to the ORIGINAL
// job's QC case. Verification → classification → paid follow-up booking
// (customer charged $0, performer paid at their normal tier rate on the
// assessed scope value). Reuses dispatch-job, crew-pay, checklists, SMS,
// and the dispute case file.
//
// Admin/VA JWT:
//   settings_get / settings_set
//   request, packet, classify, preview_price
//   approve, decline, dispatch, fallback_dispatch, send_message, report
// Service-role (complete-booking / accept-job-offer):
//   on_original_declined, on_offer_accepted, on_reclean_completed

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { ensureJobChecklist } from "../_shared/job-checklist.ts";
import { jobServiceTypeForBooking, getContractorChecklist } from "../_shared/contractor-checklists.ts";
import { parseTimeSlotToClock, sendSms } from "../_shared/sms.ts";
import { computeCrewPay, shareFor } from "../_shared/crew-pay.ts";
import {
  FOCUSED_SAME_DAY_SETTINGS_KEY,
  mergeFocusedSameDaySettings,
} from "../_shared/focused-same-day.ts";
import {
  RECLEAN_SETTINGS_KEY,
  RecleanClassification,
  RecleanScope,
  RecleanStatus,
  assessedRecleanValueCents,
  customerChargeCents,
  draftCompletionMessage,
  draftCustomerMessage,
  intakeCreatesRecleanRequest,
  isInsideGuaranteeWindow,
  jobValueForPay,
  loadRecleanSettings,
  mergeRecleanSettings,
  namedAreasFromText,
  originalCleanerDeclineCopy,
  photoMatchesAreas,
  qualityHitApplies,
  recleanRequestColumns,
  recleanSourceForIntake,
  sizeBand,
  type RecleanSettings,
} from "../_shared/reclean.ts";
import {
  assessedZoneRecleanCents,
  labeledZonePhotos,
  matchNamedZones,
  siteZoneNames,
} from "../_shared/site-zones.ts";

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
const log = (s: string, d?: unknown) =>
  console.log(`[qc-reclean] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

const SERVICE_ACTIONS = new Set([
  "on_original_declined",
  "on_offer_accepted",
  "on_reclean_completed",
]);

async function ensureAdminOrVa(admin: SB, jwt: string): Promise<{ id: string; name: string; isAdmin: boolean }> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const list = (roles || []).map((r: { role: string }) => r.role);
  if (!list.some((r: string) => ["admin", "va"].includes(r))) throw new Error("Admins or VAs only.");
  const name = String(
    u.user.user_metadata?.full_name || u.user.user_metadata?.name || u.user.email || "Team",
  );
  return { id: u.user.id, name, isAdmin: list.includes("admin") };
}

function asClass(v: unknown): RecleanClassification | null {
  return v === "quality_miss" || v === "scope_confusion" || v === "not_supported" || v === "pending"
    ? v
    : null;
}
function asScope(v: unknown): RecleanScope {
  return v === "full" ? "full" : "targeted";
}
/**
 * Stable checklist item ids this re-clean covers. Falls back to whatever was
 * already recorded so re-saving a classification never drops the tags.
 */
function checklistItemIds(
  body: Record<string, unknown>,
  issue: Record<string, unknown>,
): string[] {
  const incoming = body.checklistItemIds;
  if (Array.isArray(incoming)) {
    return Array.from(new Set(incoming.map(String).map((s) => s.trim()).filter(Boolean))).slice(0, 60);
  }
  const existing = issue.reclean_checklist_item_ids;
  return Array.isArray(existing) ? (existing as string[]) : [];
}
function httpUrls(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(String).filter((u) => u.startsWith("http"));
}

async function logEvent(
  admin: SB,
  issueId: string,
  action: string,
  actor: { id?: string | null; name?: string | null } | null,
  data: Record<string, unknown>,
  note?: string | null,
) {
  const { error } = await admin.from("qc_issue_events").insert({
    issue_id: issueId,
    action,
    note: note || null,
    actor_id: actor?.id || null,
    actor_name: actor?.name || null,
    data,
  });
  if (error) log("event insert failed", { action, message: error.message });
}

function issueInWindow(
  issue: Record<string, unknown>,
  original: Record<string, unknown>,
  settings: RecleanSettings,
): boolean {
  if (issue.reclean_inside_window === true) return true;
  if (issue.reclean_inside_window === false) return false;
  return isInsideGuaranteeWindow({
    completedAt: original.completed_at as string | null,
    serviceDate: original.service_date as string | null,
    windowHours: settings.guarantee_window_hours,
  });
}

async function loadFocusedSettings(admin: SB) {
  const { data } = await admin.from("app_settings").select("value").eq("key", FOCUSED_SAME_DAY_SETTINGS_KEY).maybeSingle();
  return mergeFocusedSameDaySettings((data as { value?: unknown } | null)?.value as never);
}

function uuidOrNull(value: unknown): string | null {
  const s = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
    ? s
    : null;
}

function areasFromIssue(issue: Record<string, unknown>, fallbackText?: string): string[] {
  const named = Array.isArray(issue.reclean_areas_named)
    ? (issue.reclean_areas_named as unknown[]).map((a) => String(a).toLowerCase()).filter(Boolean)
    : [];
  if (named.length) return named;
  const items = Array.isArray(issue.reclean_scope_items)
    ? (issue.reclean_scope_items as Array<{ areaId?: string }>).map((i) => String(i.areaId || "")).filter(Boolean)
    : [];
  if (items.length) return items;
  return namedAreasFromText(fallbackText || String(issue.description || ""));
}

function valueForScope(
  issue: Record<string, unknown>,
  original: Record<string, unknown>,
  focusedSettings: ReturnType<typeof mergeFocusedSameDaySettings>,
  override?: { scope?: RecleanScope; areas?: string[] },
): number {
  const originalZones = siteZoneNames(original.photo_zones);
  const scope = override?.scope ?? asScope(issue.reclean_scope);
  if (originalZones.length) {
    const zones = matchNamedZones(
      override?.areas ?? issue.reclean_areas_named,
      originalZones,
      String(issue.zone_name || ""),
    );
    const n = scope === "full" ? originalZones.length : (zones.length || 1);
    return assessedZoneRecleanCents(
      Number(original.final_charge_cents ?? original.total_estimate_cents ?? original.custom_quote_cents ?? 0) || 0,
      n,
      originalZones.length,
    );
  }
  const areas = override?.areas ?? areasFromIssue(issue);
  return assessedRecleanValueCents({
    scope,
    areas,
    originalChargeCents: Number(original.final_charge_cents ?? original.total_estimate_cents ?? 0) || 0,
    focusedSettings,
  });
}

async function packetFor(admin: SB, issue: Record<string, unknown>, original: Record<string, unknown>) {
  const bookingId = String(issue.booking_id || original.id);
  const recleanBookingId = issue.reclean_booking_id ? String(issue.reclean_booking_id) : null;
  const origJobId = original.job_id ? String(original.job_id) : null;
  const areas = areasFromIssue(issue);

  const [
    { data: origDoc },
    { data: recleanBooking },
    { data: recleanDoc },
    { data: checklist },
    { data: origJob },
  ] = await Promise.all([
    admin.from("job_documentation").select("*").eq("booking_id", bookingId).maybeSingle(),
    recleanBookingId
      ? admin.from("bookings").select("id, job_id, before_photos, after_photos, status, service_date, time_slot, cleaner_id, reclean_assessed_value_cents, is_reclean").eq("id", recleanBookingId).maybeSingle()
      : Promise.resolve({ data: null }),
    recleanBookingId
      ? admin.from("job_documentation").select("*").eq("booking_id", recleanBookingId).maybeSingle()
      : Promise.resolve({ data: null }),
    origJobId
      ? admin.from("job_checklists").select("*").eq("job_id", origJobId).maybeSingle()
      : Promise.resolve({ data: null }),
    origJobId
      ? admin.from("jobs").select("id, status, notes").eq("id", origJobId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const recleanJobId = recleanBooking?.job_id ? String(recleanBooking.job_id) : null;
  const { data: recleanChecklist } = recleanJobId
    ? await admin.from("job_checklists").select("*").eq("job_id", recleanJobId).maybeSingle()
    : { data: null };

  const origBefore = [
    ...httpUrls(original.before_photos),
    ...httpUrls((origDoc as { before_photos?: unknown } | null)?.before_photos),
  ].filter((u, i, a) => a.indexOf(u) === i);
  const origAfter = [
    ...httpUrls(original.after_photos),
    ...httpUrls((origDoc as { after_photos?: unknown } | null)?.after_photos),
  ].filter((u, i, a) => a.indexOf(u) === i);

  const siteZones = siteZoneNames(original.photo_zones);
  const issueZone = String(issue.zone_name || "").trim();
  const restrictZones = issueZone ? matchNamedZones([issueZone], siteZones, issueZone) : siteZones;
  const spec = siteZones.length
    ? getContractorChecklist(
      String(original.service_type || "commercial"),
      [],
      undefined,
      { scopeLevel: String(original.scope_level || "standard"), photoZones: siteZones },
    )
    : null;
  const sectionMeta = (checklist as { section_meta?: Record<string, { before?: string[]; after?: string[] }> } | null)?.section_meta || {};
  const zonePhotoSeq = spec
    ? labeledZonePhotos(sectionMeta, spec.sections, restrictZones.length ? restrictZones : siteZones)
    : [];
  const zoneBefore = zonePhotoSeq.filter((p) => p.kind === "before").map((p) => p.url);
  const zoneAfter = zonePhotoSeq.filter((p) => p.kind === "after").map((p) => p.url);
  const packetBefore = zoneBefore.length ? zoneBefore : origBefore;
  const packetAfter = zoneAfter.length ? zoneAfter : origAfter;
  const recleanBefore = [
    ...httpUrls(recleanBooking?.before_photos),
    ...httpUrls((recleanDoc as { before_photos?: unknown } | null)?.before_photos),
  ].filter((u, i, a) => a.indexOf(u) === i);
  const recleanAfter = [
    ...httpUrls(recleanBooking?.after_photos),
    ...httpUrls((recleanDoc as { after_photos?: unknown } | null)?.after_photos),
  ].filter((u, i, a) => a.indexOf(u) === i);

  const filterAreas = (urls: string[]) => urls.filter((u) => photoMatchesAreas(u, areas));

  const items = ((checklist as { items?: Record<string, unknown> } | null)?.items || {}) as Record<string, unknown>;
  const skipped: Array<{ key: string; reason: string; by?: string }> = [];
  for (const [key, value] of Object.entries(items)) {
    const rec = value as { skipped?: boolean; skipReason?: string; by?: string };
    if (rec && rec.skipped) skipped.push({ key, reason: String(rec.skipReason || ""), by: rec.by });
  }
  const conditionsFound: Array<{ section: string; note?: string; photos?: unknown; at?: string }> = [];
  for (const [k, v] of Object.entries(sectionMeta)) {
    const rec = v as { conditions_note?: string; conditions_photos?: unknown; conditions_at?: string };
    if (rec && rec.conditions_note) {
      conditionsFound.push({
        section: k,
        note: rec.conditions_note,
        photos: rec.conditions_photos,
        at: rec.conditions_at,
      });
    }
  }

  let crew: Array<{ id: string; name: string; role: string | null; status: string }> = [];
  if (origJobId) {
    const { data: assigns } = await admin
      .from("job_assignments")
      .select("cleaner_id, role, status, cleaners(first_name, last_name)")
      .eq("job_id", origJobId);
    for (const a of assigns || []) {
      if (!["confirmed", "accepted", "completed", "in progress"].includes(String(a.status || "").toLowerCase())) continue;
      const c = Array.isArray(a.cleaners) ? a.cleaners[0] : a.cleaners;
      crew.push({
        id: a.cleaner_id,
        name: c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Cleaner",
        role: a.role || null,
        status: a.status,
      });
    }
  }
  if (crew.length === 0 && original.cleaner_id) {
    const { data: c } = await admin.from("cleaners").select("id, first_name, last_name").eq("id", original.cleaner_id).maybeSingle();
    if (c) {
      crew = [{
        id: c.id,
        name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner",
        role: "Lead",
        status: "assigned",
      }];
    }
  }

  const fourStageSequence = [
    ...(siteZones.length ? packetBefore : filterAreas(origBefore)).map((url) => ({ stage: "original_before", url })),
    ...(siteZones.length ? packetAfter : filterAreas(origAfter)).map((url) => ({ stage: "original_after", url })),
    ...recleanBefore.map((url) => ({ stage: "reclean_before", url })),
    ...recleanAfter.map((url) => ({ stage: "reclean_after", url })),
  ];

  return {
    originalBookingId: bookingId,
    recleanBookingId,
    originalJob: origJob,
    recleanJobId,
    originalCrew: crew,
    namedAreas: siteZones.length ? (restrictZones.length ? restrictZones : siteZones) : areas,
    siteZones,
    issueZone: issueZone || null,
    zonePhotos: zonePhotoSeq,
    originalPhotos: {
      before: siteZones.length ? packetBefore : filterAreas(origBefore),
      after: siteZones.length ? packetAfter : filterAreas(origAfter),
      allBefore: origBefore,
      allAfter: origAfter,
    },
    recleanPhotos: { before: recleanBefore, after: recleanAfter },
    fourStageSequence,
    checklist: checklist
      ? {
        service_type: (checklist as { service_type?: string }).service_type,
        progress_pct: (checklist as { progress_pct?: number }).progress_pct,
        completed_items: (checklist as { completed_items?: number }).completed_items,
        total_items: (checklist as { total_items?: number }).total_items,
        completed_at: (checklist as { completed_at?: string }).completed_at,
      }
      : null,
    recleanChecklist: recleanChecklist
      ? {
        progress_pct: (recleanChecklist as { progress_pct?: number }).progress_pct,
        completed_items: (recleanChecklist as { completed_items?: number }).completed_items,
        total_items: (recleanChecklist as { total_items?: number }).total_items,
      }
      : null,
    skippedItems: skipped,
    conditionsFound,
    qualityHitApplies: qualityHitApplies(issue.reclean_classification as string),
  };
}

async function sendCustomerEmail(admin: SB, to: string, subject: string, html: string) {
  const { error } = await admin.functions.invoke("admin-send-email", {
    body: { to, subject, html, from: "Novara Cleaning <contact@novaracleaning.com>" },
  });
  if (error) log("email failed", error.message || String(error));
}

function nextServiceDate(preferred: string | null | undefined, _original?: Record<string, unknown>) {
  if (preferred && /^\d{4}-\d{2}-\d{2}$/.test(preferred)) return preferred;
  // Always schedule from today, not the original service date — a complaint
  // filed days later would otherwise land as a past-dated booking and vanish
  // from "upcoming" views.
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function dispatchApprovedReclean(
  admin: SB,
  issue: Record<string, unknown>,
  actor: { id: string; name: string; isAdmin: boolean } | null,
  opts: { customerPrefersOther?: boolean },
): Promise<Record<string, unknown>> {
  if (!issue.reclean_booking_id) throw new Error("Approve the re-clean before dispatching.");
  const { data: recleanBooking } = await admin.from("bookings").select("*").eq("id", issue.reclean_booking_id).maybeSingle();
  if (!recleanBooking) throw new Error("Re-clean booking missing.");
  const payCents = jobValueForPay(recleanBooking);
  const { data: original } = await admin.from("bookings").select("*").eq("id", issue.booking_id).maybeSingle();
  const recleanJobId = recleanBooking.job_id as string | null;
  if (!recleanJobId) throw new Error("Re-clean job is missing.");
  const issueId = String(issue.id);

  const originalCleanerId = original?.cleaner_id ? String(original.cleaner_id) : null;
  const customerPrefersOther = Boolean(issue.reclean_customer_prefers_other) || opts.customerPrefersOther === true;

  if (customerPrefersOther || !originalCleanerId) {
    const { data: dispatched, error } = await admin.functions.invoke("dispatch-job", {
      body: { jobId: recleanJobId, approved: true },
    });
    if (error) throw new Error(error.message || "dispatch-job failed");
    await admin.from("qc_issues").update({
      reclean_status: "dispatched",
      reclean_original_offer_status: "skipped_customer_pref",
    }).eq("id", issueId);
    await logEvent(admin, issueId, "reclean_dispatched", actor, {
      via: "ranked",
      reason: customerPrefersOther ? "customer_requested_different_team" : "no_original_cleaner",
      note: customerPrefersOther ? originalCleanerDeclineCopy() : null,
    });
    return { via: "ranked", dispatched, payCents };
  }

  const shares = await computeCrewPay(admin, payCents, [originalCleanerId]);
  const share = shareFor(shares, originalCleanerId);
  if (!share || share.shareCents <= 0) {
    throw new Error("Cannot dispatch an unpaid re-clean.");
  }
  const { data: cleaner } = await admin.from("cleaners")
    .select("id, phone, email, first_name, last_name")
    .eq("id", originalCleanerId).maybeSingle();
  const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const tokenBytes = new Uint8Array(16);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  await admin.from("job_assignments").upsert({
    job_id: recleanJobId,
    cleaner_id: originalCleanerId,
    status: "Offered",
    role: "Lead",
    offered_at: new Date().toISOString(),
    expires_at: expires,
    response_token: token,
    estimated_pay_cents: share.shareCents,
    pay_percentage_snapshot: share.ratePercent,
    crew_size_snapshot: 1,
    reliability_neutral: true,
  }, { onConflict: "job_id,cleaner_id" });

  const offerUrl = `https://contractor.novaracleaning.com/cleaner/job-offer/${token}`;
  if (cleaner?.phone) {
    await sendSms(admin, {
      toPhone: cleaner.phone,
      message:
        `Novara re-clean (paid, Spotless Guarantee) at ${original?.address || "the property"} on ${recleanBooking.service_date}. ` +
        `Your pay $${(share.shareCents / 100).toFixed(2)}. This is not a penalty — declining is OK. ${offerUrl}`,
      type: "job_offer",
    });
  }
  await admin.from("qc_issues").update({
    reclean_status: "offered",
    reclean_offered_to_cleaner_id: originalCleanerId,
    reclean_original_offer_status: "offered",
    reclean_offered_at: new Date().toISOString(),
  }).eq("id", issueId);
  await admin.from("jobs").update({ status: "Offered" }).eq("id", recleanJobId);
  await logEvent(admin, issueId, "reclean_offered", actor, {
    cleanerId: originalCleanerId,
    payCents: share.shareCents,
    reliabilityPenalty: false,
  });
  return {
    via: "original_cleaner",
    cleanerId: originalCleanerId,
    payCents: share.shareCents,
    offerUrl,
    note: "Declining this offer is not a reliability penalty.",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").toLowerCase();
    if (!action) return json({ ok: false, error: "action required" }, 400);

    let actor: { id: string; name: string; isAdmin: boolean } | null = null;
    if (!SERVICE_ACTIONS.has(action)) {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!jwt) return json({ ok: false, error: "Not signed in." }, 401);
      actor = await ensureAdminOrVa(admin, jwt);
    }

    if (action === "settings_get") {
      return json({ ok: true, settings: await loadRecleanSettings(admin) });
    }
    if (action === "settings_set") {
      if (!actor?.isAdmin) return json({ ok: false, error: "Only admins can change re-clean settings." }, 403);
      const settings = mergeRecleanSettings(body.settings);
      await admin.from("app_settings").upsert({
        key: RECLEAN_SETTINGS_KEY,
        value: settings,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
      return json({ ok: true, settings });
    }

    if (action === "request") {
      const bookingId = String(body.bookingId || "");
      if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);
      const { data: original } = await admin.from("bookings").select("*").eq("id", bookingId).maybeSingle();
      if (!original) return json({ ok: false, error: "Booking not found." }, 404);
      if (original.is_reclean) return json({ ok: false, error: "Cannot request a re-clean of a re-clean job." }, 400);
      const settings = await loadRecleanSettings(admin);
      const issueType = String(body.issueType || "reclean");
      const reportedVia = String(body.reportedVia || "va");
      const requestReclean = body.requestReclean !== false;
      if (!intakeCreatesRecleanRequest({ issueType, reportedVia, requestReclean })) {
        return json({ ok: false, error: "This intake path does not create a re-clean request." }, 400);
      }
      const description = String(body.description || "").trim() || "Customer requested a re-clean.";
      const title = String(body.title || "").trim() || `Re-clean request on ${original.booking_number ? `NVC-${String(original.booking_number).padStart(4, "0")}` : bookingId.slice(0, 8)}`;
      const cols = recleanRequestColumns({
        completedAt: original.completed_at,
        serviceDate: original.service_date,
        windowHours: settings.guarantee_window_hours,
      });
      const areas = Array.isArray(body.areas)
        ? (body.areas as unknown[]).map((a) => String(a))
        : namedAreasFromText(description);
      const { data: issue, error } = await admin.from("qc_issues").insert({
        booking_id: bookingId,
        job_id: original.job_id,
        client_type: original.booking_type === "commercial" ? "commercial" : "residential",
        cleaner_id: original.cleaner_id,
        client_name: `${original.first_name || ""} ${original.last_name || ""}`.trim() || null,
        client_email: original.email,
        booking_ref: original.booking_number ? `NVC-${String(original.booking_number).padStart(4, "0")}` : bookingId.slice(0, 8),
        issue_type: issueType === "quality_flag" ? "quality_flag" : issueType === "complaint" ? "complaint" : "reclean",
        severity: String(body.severity || "medium"),
        status: "open",
        title,
        description,
        reported_via: reportedVia,
        reported_by: actor?.id || null,
        reported_by_name: actor?.name || "Team",
        reclean_source: recleanSourceForIntake({ issueType, reportedVia }),
        reclean_scope: "targeted",
        reclean_areas_named: areas,
        ...cols,
      }).select("*").single();
      if (error) throw error;
      await logEvent(admin, issue.id, "reclean_requested", actor, {
        source: recleanSourceForIntake({ issueType, reportedVia }),
        insideWindow: cols.reclean_inside_window,
      });
      return json({ ok: true, issue, inWindow: cols.reclean_inside_window });
    }

    if (action === "packet") {
      const issueId = String(body.issueId || "");
      const { data: issue } = await admin.from("qc_issues").select("*").eq("id", issueId).maybeSingle();
      if (!issue) return json({ ok: false, error: "QC case not found." }, 404);
      const { data: original } = await admin.from("bookings").select("*").eq("id", issue.booking_id).maybeSingle();
      if (!original) return json({ ok: false, error: "Booking not found." }, 404);
      const settings = await loadRecleanSettings(admin);
      const focused = await loadFocusedSettings(admin);
      const pkt = await packetFor(admin, issue, original);
      const draft = draftCustomerMessage({
        classification: (asClass(issue.reclean_classification) || "pending") as RecleanClassification,
        firstName: original.first_name,
        serviceDate: original.service_date,
        timeSlot: original.time_slot,
        scope: asScope(issue.reclean_scope),
        scopeSummary: pkt.namedAreas.length ? pkt.namedAreas.join(", ") : null,
      });
      return json({
        ok: true,
        issue,
        originalBooking: {
          id: original.id,
          booking_number: original.booking_number,
          service_date: original.service_date,
          time_slot: original.time_slot,
          service_type: original.service_type,
          access_notes: original.access_notes,
          team_notes: original.team_notes,
          issues_notes: original.issues_notes,
          dispatch_notes: original.dispatch_notes,
          address: original.address,
          city: original.city,
          state: original.state,
          zip_code: original.zip_code,
          first_name: original.first_name,
          last_name: original.last_name,
          email: original.email,
          phone: original.phone,
          completed_at: original.completed_at,
          cleaner_id: original.cleaner_id,
          job_id: original.job_id,
          sqft: original.sqft,
          final_charge_cents: original.final_charge_cents,
          total_estimate_cents: original.total_estimate_cents,
          cleaner_payout_cents: original.cleaner_payout_cents,
        },
        inWindow: issueInWindow(issue, original, settings),
        settings,
        assessedValueCents: valueForScope(issue, original, focused),
        customerChargeCents: 0,
        packet: pkt,
        draftMessage: issue.reclean_message_draft || draft.body,
        draftSms: draft.sms,
        draftSubject: draft.subject,
      });
    }

    if (action === "classify") {
      const issueId = String(body.issueId || "");
      const { data: issue } = await admin.from("qc_issues").select("*").eq("id", issueId).maybeSingle();
      if (!issue) return json({ ok: false, error: "QC case not found." }, 404);
      const classification = asClass(body.classification);
      if (!classification || classification === "pending") {
        return json({ ok: false, error: "classification must be quality_miss, scope_confusion, or not_supported" }, 400);
      }
      const notes = String(body.notes || "").trim();
      const areas = Array.isArray(body.areas) ? (body.areas as unknown[]).map(String) : issue.reclean_areas_named;
      const scope = asScope(body.scope || issue.reclean_scope);
      const { data: updated, error } = await admin.from("qc_issues").update({
        reclean_classification: classification,
        reclean_status: "classified" as RecleanStatus,
        reclean_verified_at: new Date().toISOString(),
        reclean_verified_by: actor!.id,
        reclean_verified_by_name: actor!.name,
        reclean_scope: scope,
        reclean_areas_named: areas,
        reclean_scope_items: Array.isArray(body.items) ? body.items : issue.reclean_scope_items,
        // The targeted scope resolved to stable checklist item ids, so this
        // re-clean's classification becomes countable signal against the item.
        reclean_checklist_item_ids: checklistItemIds(body, issue),
      }).eq("id", issueId).select("*").single();
      if (error) throw error;
      await logEvent(admin, issueId, "reclean_classified", actor, { classification, notes, qualityHitApplies: qualityHitApplies(classification) }, notes || null);
      return json({ ok: true, issue: updated, qualityHitApplies: qualityHitApplies(classification) });
    }

    if (action === "preview_price") {
      const issueId = String(body.issueId || "");
      const { data: issue } = await admin.from("qc_issues").select("*").eq("id", issueId).maybeSingle();
      if (!issue) return json({ ok: false, error: "QC case not found." }, 404);
      const { data: original } = await admin.from("bookings").select("*").eq("id", issue.booking_id).maybeSingle();
      if (!original) return json({ ok: false, error: "Booking not found." }, 404);
      const focused = await loadFocusedSettings(admin);
      const scope = asScope(body.scope || issue.reclean_scope);
      const areas = Array.isArray(body.areas) ? (body.areas as unknown[]).map(String) : areasFromIssue(issue);
      const cents = valueForScope(issue, original, focused, { scope, areas });
      return json({
        ok: true,
        assessedValueCents: cents,
        customerChargeCents: customerChargeCents({ is_reclean: true, reclean_assessed_value_cents: cents }),
        scope,
        areas,
      });
    }

    if (action === "approve") {
      const issueId = String(body.issueId || "");
      const { data: issue } = await admin.from("qc_issues").select("*").eq("id", issueId).maybeSingle();
      if (!issue) return json({ ok: false, error: "QC case not found." }, 404);
      if (issue.reclean_booking_id) {
        return json({ ok: false, error: "A re-clean booking already exists for this case." }, 409);
      }
      const { data: original } = await admin.from("bookings").select("*").eq("id", issue.booking_id).maybeSingle();
      if (!original) return json({ ok: false, error: "Booking not found." }, 404);
      if (original.is_reclean) return json({ ok: false, error: "Cannot re-clean a re-clean." }, 400);
      const settings = await loadRecleanSettings(admin);
      const focused = await loadFocusedSettings(admin);
      const classification = asClass(body.classification || issue.reclean_classification);
      if (!classification || classification === "pending") {
        return json({ ok: false, error: "Classify the request before approving a re-clean." }, 400);
      }
      const scope = asScope(body.scope || issue.reclean_scope);
      const goodwill = body.goodwill === true;
      const inWindow = issueInWindow(issue, original, settings);
      // Clicking Approve is the honor decision. Record it when the original
      // visit is outside the guarantee window so the UI checkbox cannot block
      // an admin who already chose to make it right.
      const honorOutsideWindow = !inWindow || body.honorOutsideWindow === true;
      if (classification === "not_supported" && !goodwill) {
        return json({ ok: false, error: "Not-supported requests are not dispatched by default. Check “approve as goodwill” to send a paid courtesy re-clean." }, 400);
      }
      if (scope === "full" && body.fullApproved !== true) {
        return json({ ok: false, error: "Full re-service requires checking the admin-approve box (reserved for jobs that substantially failed)." }, 400);
      }
      const areas = (Array.isArray(body.areas) ? (body.areas as unknown[]).map(String) : [])
        .map((a) => String(a).toLowerCase().trim())
        .filter(Boolean);
      const originalZones = siteZoneNames(original.photo_zones);
      const requestedZones = matchNamedZones(
        [
          ...(Array.isArray(body.zones) ? body.zones : []),
          ...(Array.isArray(body.areas) ? body.areas : []),
        ],
        originalZones,
        String(issue.zone_name || ""),
      );
      const recleanZones = scope === "full" && originalZones.length
        ? originalZones
        : requestedZones;
      const zonedTargeted = originalZones.length > 0 && scope === "targeted";
      const resolvedAreas = zonedTargeted
        ? recleanZones
        : (areas.length ? areas : areasFromIssue(issue, String(issue.description || "")));
      if (scope === "targeted" && resolvedAreas.length === 0 && !Number(body.assessedValueCents)) {
        return json({
          ok: false,
          error: originalZones.length
            ? `Pick the zone(s) to re-clean (${originalZones.join(", ")}) so the follow-up is scoped to that section, not the whole facility.`
            : "Pick the areas to re-clean (kitchen, bathroom, …) so the pricing engine can assess pay.",
        }, 400);
      }
      let assessed = zonedTargeted || (originalZones.length && scope === "full")
        ? assessedZoneRecleanCents(
          Number(original.final_charge_cents ?? original.total_estimate_cents ?? original.custom_quote_cents ?? 0) || 0,
          recleanZones.length || originalZones.length,
          originalZones.length,
        )
        : valueForScope(issue, original, focused, { scope, areas: resolvedAreas });
      if (Number(body.assessedValueCents) > 0) assessed = Math.round(Number(body.assessedValueCents));
      if (assessed <= 0) {
        return json({ ok: false, error: "Re-clean assessed value must be greater than $0 — unpaid re-cleans are prohibited." }, 400);
      }

      const serviceDate = nextServiceDate(body.serviceDate ? String(body.serviceDate) : null, original);
      const timeSlot = String(body.timeSlot || original.time_slot || "morning");
      const customerPrefersOther = body.customerPrefersOther === true;
      const scopeSummary = originalZones.length
        ? recleanZones.join(", ")
        : (resolvedAreas.length ? resolvedAreas.join(", ") : null);
      const draft = draftCustomerMessage({
        classification,
        firstName: original.first_name,
        serviceDate,
        timeSlot,
        scope,
        scopeSummary,
      });
      const message = String(body.customerMessage || "").trim() || draft.body;

      const keepCommercial = originalZones.length > 0;
      const focusedAreas = keepCommercial
        ? (original.focused_areas || [])
        : (scope === "targeted"
          ? resolvedAreas.map((areaId) => ({ areaId, quantity: 1 }))
          : original.focused_areas);
      const originalRef = original.booking_number
        ? `NVC-${String(original.booking_number).padStart(4, "0")}`
        : String(original.id).slice(0, 8);
      const special = [
        String(original.team_notes || "").trim(),
        `RE-CLEAN of ${originalRef} — ${scope === "full" ? "full re-service" : `targeted: ${scopeSummary || "see QC case"}`}. Spotless Guarantee — customer not charged. Performer is paid on assessed value $${(assessed / 100).toFixed(2)}.`,
      ].filter(Boolean).join("\n");

      const insert: Record<string, unknown> = {
        customer_id: original.customer_id,
        first_name: original.first_name,
        last_name: original.last_name || "",
        email: original.email,
        phone: original.phone,
        address: original.address,
        city: original.city,
        state: original.state,
        zip_code: original.zip_code,
        home_size_id: original.home_size_id,
        estimated_duration_hours: scope === "full"
          ? (Number(original.estimated_duration_hours) || 3)
          : Math.max(1, resolvedAreas.length * 0.75),
        service_type: keepCommercial || scope === "full" ? original.service_type : "focused",
        service_date: serviceDate,
        time_slot: timeSlot,
        status: "confirmed",
        bedrooms: original.bedrooms,
        bathrooms: original.bathrooms,
        sqft: original.sqft,
        add_ons: scope === "full" || keepCommercial ? original.add_ons : [],
        focused_areas: focusedAreas,
        access_notes: original.access_notes,
        team_notes: special,
        issues_notes: original.issues_notes,
        dispatch_notes: original.dispatch_notes,
        // Customer charge is always $0. base_price_cents is NOT NULL with no
        // default — omitting it is what made Approve 400 on real bookings.
        base_price_cents: 0,
        total_estimate_cents: 0,
        deposit_cents: 0,
        final_charge_cents: 0,
        payment_option: original.payment_option || "full",
        booking_channel: "reclean",
        booking_type: original.booking_type || "residential",
        is_reclean: true,
        reclean_of_booking_id: original.id,
        reclean_qc_issue_id: issue.id,
        reclean_scope: scope,
        reclean_assessed_value_cents: assessed,
        suppress_review_request: true,
        business_account_id: original.business_account_id || null,
        business_site_id: original.business_site_id || null,
        facility_type: original.facility_type || null,
        square_footage: original.square_footage || original.sqft || null,
        scope_level: original.scope_level || null,
        photo_zones: keepCommercial ? recleanZones : (original.photo_zones || null),
        reclean_zones: keepCommercial ? recleanZones : null,
      };
      const { data: recleanBooking, error: bErr } = await admin.from("bookings").insert(insert).select("*").single();
      if (bErr) throw new Error(`Could not create re-clean booking: ${bErr.message}`);

      const startTime = parseTimeSlotToClock(timeSlot).start || "09:00:00";
      const startDatetime = `${serviceDate}T${startTime}`;
      const { data: job, error: jErr } = await admin.from("jobs").insert({
        // bookings.customer_id is text (often a Stripe cus_ id). jobs.customer_id
        // is uuid — passing the Stripe id 400s the whole approve.
        customer_id: uuidOrNull(original.customer_id),
        address: original.address || "Address on file",
        city: original.city || "Unknown",
        state: original.state || "MD",
        zip: original.zip_code || "00000",
        service_type: jobServiceTypeForBooking({ ...recleanBooking, service_type: insert.service_type }),
        start_datetime: startDatetime,
        duration_est_hours: scope === "full" ? (Number(original.estimated_duration_hours) || 3) : Math.max(1, resolvedAreas.length * 0.75),
        sq_ft: Math.round(Number(original.sqft) || 2000),
        bedrooms: Math.round(Number(original.bedrooms) || 0),
        bathrooms: Number(original.bathrooms) || 0,
        min_cleaners_required: 1,
        status: "New",
        notes: special,
      }).select("id").single();
      if (jErr || !job) throw new Error(`Could not create re-clean job: ${jErr?.message || "unknown"}`);
      await admin.from("bookings").update({ job_id: job.id }).eq("id", recleanBooking.id);
      recleanBooking.job_id = job.id;
      await ensureJobChecklist(admin, { jobId: job.id, bookingId: recleanBooking.id });

      await admin.from("qc_issues").update({
        reclean_classification: classification,
        reclean_status: "approved",
        reclean_scope: scope,
        reclean_areas_named: resolvedAreas,
        reclean_scope_items: Array.isArray(body.items) ? body.items : resolvedAreas.map((areaId) => ({ areaId, quantity: 1 })),
        reclean_checklist_item_ids: checklistItemIds(body, issue),
        reclean_booking_id: recleanBooking.id,
        reclean_assessed_value_cents: assessed,
        reclean_customer_prefers_other: customerPrefersOther,
        reclean_message_draft: message,
        reclean_honored_outside_window: honorOutsideWindow && !inWindow,
        reclean_inside_window: inWindow,
        reclean_guarantee_window_hours: settings.guarantee_window_hours,
        reclean_requested_at: issue.reclean_requested_at || new Date().toISOString(),
        reclean_goodwill: goodwill || classification === "scope_confusion",
        reclean_verified_at: issue.reclean_verified_at || new Date().toISOString(),
        reclean_verified_by: issue.reclean_verified_by || actor!.id,
        reclean_verified_by_name: issue.reclean_verified_by_name || actor!.name,
        status: "investigating",
        ...(recleanZones[0] && !issue.zone_name ? { zone_name: recleanZones[0] } : {}),
      }).eq("id", issue.id);

      await logEvent(admin, issueId, "reclean_approved", actor, {
        classification,
        scope,
        assessed,
        recleanBookingId: recleanBooking.id,
        bookingNumber: recleanBooking.booking_number,
        customerPrefersOther,
        goodwill,
        inWindow,
        honorOutsideWindow: honorOutsideWindow && !inWindow,
        qualityHitApplies: qualityHitApplies(classification),
      });

      let dispatchResult: Record<string, unknown> | null = null;
      let dispatchError: string | null = null;
      try {
        const { data: freshIssue } = await admin.from("qc_issues").select("*").eq("id", issue.id).maybeSingle();
        dispatchResult = await dispatchApprovedReclean(admin, freshIssue || { ...issue, reclean_booking_id: recleanBooking.id }, actor, {
          customerPrefersOther,
        });
      } catch (e) {
        dispatchError = e instanceof Error ? e.message : String(e);
        log("auto-dispatch after approve failed", dispatchError);
      }

      return json({
        ok: true,
        recleanBookingId: recleanBooking.id,
        recleanBookingNumber: recleanBooking.booking_number ?? null,
        jobId: job.id,
        assessedValueCents: assessed,
        customerChargeCents: 0,
        qualityHitApplies: qualityHitApplies(classification),
        draftMessage: message,
        draftSubject: draft.subject,
        draftSms: draft.sms,
        dispatched: dispatchResult,
        dispatchError,
      });
    }

    if (action === "decline") {
      const issueId = String(body.issueId || "");
      const { data: issue } = await admin.from("qc_issues").select("*").eq("id", issueId).maybeSingle();
      if (!issue) return json({ ok: false, error: "QC case not found." }, 404);
      const { data: original } = await admin.from("bookings").select("first_name, service_date, time_slot").eq("id", issue.booking_id).maybeSingle();
      const classification = asClass(body.classification || issue.reclean_classification) || "not_supported";
      const draft = draftCustomerMessage({
        classification,
        firstName: original?.first_name,
        serviceDate: original?.service_date,
        timeSlot: original?.time_slot,
      });
      const message = String(body.customerMessage || "").trim() || draft.body;
      await admin.from("qc_issues").update({
        reclean_classification: classification,
        reclean_status: "declined",
        reclean_message_draft: message,
        reclean_verified_at: new Date().toISOString(),
        reclean_verified_by: actor!.id,
        reclean_verified_by_name: actor!.name,
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: actor!.id,
        resolved_by_name: actor!.name,
        resolution_note: String(body.notes || "Re-clean not dispatched. Customer contacted with documentation."),
      }).eq("id", issueId);
      await logEvent(admin, issueId, "reclean_declined", actor, { classification });
      return json({ ok: true, draftMessage: message, draftSubject: draft.subject, draftSms: draft.sms });
    }

    if (action === "dispatch") {
      const issueId = String(body.issueId || "");
      const { data: issue } = await admin.from("qc_issues").select("*").eq("id", issueId).maybeSingle();
      if (!issue) return json({ ok: false, error: "QC case not found." }, 404);
      try {
        const dispatched = await dispatchApprovedReclean(admin, issue, actor, {
          customerPrefersOther: body.customerPrefersOther === true,
        });
        return json({ ok: true, ...dispatched });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status = /missing|approve|unpaid/i.test(msg) ? 400 : 500;
        return json({ ok: false, error: msg }, status);
      }
    }

    if (action === "fallback_dispatch") {
      const issueId = String(body.issueId || "");
      const { data: issue } = await admin.from("qc_issues").select("*").eq("id", issueId).maybeSingle();
      if (!issue?.reclean_booking_id) return json({ ok: false, error: "Approve first." }, 400);
      const { data: reclean } = await admin.from("bookings").select("job_id").eq("id", issue.reclean_booking_id).maybeSingle();
      if (!reclean?.job_id) return json({ ok: false, error: "Missing re-clean job." }, 400);
      const { data: dispatched, error } = await admin.functions.invoke("dispatch-job", {
        body: { jobId: reclean.job_id, approved: true },
      });
      if (error) throw new Error(error.message || "dispatch-job failed");
      await admin.from("qc_issues").update({
        reclean_status: "dispatched",
        reclean_original_offer_status: issue.reclean_original_offer_status === "declined" ? "declined" : "expired",
      }).eq("id", issueId);
      await logEvent(admin, issueId, "reclean_dispatched", actor, { via: "ranked_fallback" });
      return json({ ok: true, dispatched });
    }

    if (action === "on_original_declined") {
      const bookingId = String(body.bookingId || "");
      const { data: reclean } = await admin.from("bookings").select("*").eq("id", bookingId).maybeSingle();
      if (!reclean?.is_reclean) return json({ ok: true, skipped: true });
      const { data: issue } = await admin.from("qc_issues").select("*").eq("reclean_booking_id", bookingId).maybeSingle();
      if (issue) {
        await admin.from("qc_issues").update({
          reclean_original_offer_status: "declined",
          reclean_status: "approved",
        }).eq("id", issue.id);
        await logEvent(admin, issue.id, "reclean_offer_declined", null, { reliabilityPenalty: false });
      }
      if (reclean.job_id) {
        const { data: dispatched, error } = await admin.functions.invoke("dispatch-job", {
          body: { jobId: reclean.job_id, approved: true },
        });
        if (error) log("fallback dispatch failed", error.message || String(error));
        if (issue) {
          await admin.from("qc_issues").update({ reclean_status: "dispatched" }).eq("id", issue.id);
        }
        return json({ ok: true, dispatched, reliabilityPenalty: false });
      }
      return json({ ok: true, reliabilityPenalty: false });
    }

    if (action === "on_offer_accepted") {
      const bookingId = String(body.bookingId || "");
      const cleanerId = body.cleanerId ? String(body.cleanerId) : null;
      const { data: reclean } = await admin.from("bookings").select("*").eq("id", bookingId).maybeSingle();
      if (!reclean?.is_reclean) return json({ ok: true, skipped: true });
      const { data: issue } = await admin.from("qc_issues").select("id").eq("reclean_booking_id", bookingId).maybeSingle();
      if (issue) {
        await admin.from("qc_issues").update({
          reclean_status: "dispatched",
          reclean_original_offer_status: "accepted",
          reclean_performed_by_cleaner_id: cleanerId,
        }).eq("id", issue.id);
      }
      return json({ ok: true });
    }

    if (action === "on_reclean_completed") {
      const bookingId = String(body.bookingId || "");
      const { data: reclean } = await admin.from("bookings").select("*").eq("id", bookingId).maybeSingle();
      if (!reclean?.is_reclean) return json({ ok: true, skipped: true });
      const pay = jobValueForPay(reclean);
      const { data: issue } = await admin.from("qc_issues").select("*").eq("reclean_booking_id", bookingId).maybeSingle();
      const performer = reclean.cleaner_id || null;
      const after = httpUrls(reclean.after_photos);
      if (issue) {
        const absorbed = Number(reclean.cleaner_payout_cents) || 0;
        await admin.from("qc_issues").update({
          reclean_status: "completed",
          reclean_performed_by_cleaner_id: performer,
          reclean_pay_cents: absorbed || pay,
          reclean_absorbed_cost_cents: absorbed || pay,
          reclean_completed_at: new Date().toISOString(),
          reclean_resolution_photos: after,
          reclean_completion_notified_at: new Date().toISOString(),
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolution_note:
            `Re-clean completed. Performer paid on assessed value $${(pay / 100).toFixed(2)} ` +
            `(payout $${((absorbed || pay) / 100).toFixed(2)}). Customer not charged. Company absorbed the cost.`,
        }).eq("id", issue.id);
        await logEvent(admin, issue.id, "reclean_completed", null, { pay, absorbed, performer });

        const { data: original } = await admin.from("bookings").select("first_name, email, phone").eq("id", issue.booking_id).maybeSingle();
        const photosHtml = after
          .map((u) => `<p><img src="${u}" alt="" style="max-width:100%;border-radius:8px" /></p>`)
          .join("");
        const msg = draftCompletionMessage({
          firstName: original?.first_name || reclean.first_name,
          photoCount: after.length,
        });
        const email = original?.email || reclean.email;
        const phone = original?.phone || reclean.phone;
        if (email) {
          await sendCustomerEmail(admin, email, msg.subject, `<p>${msg.body.replace(/\n/g, "<br/>")}</p>${photosHtml}`);
        }
        if (phone) {
          await sendSms(admin, { toPhone: phone, message: msg.sms, type: "confirmation" });
        }
      }
      return json({ ok: true, payCents: pay, customerChargeCents: 0 });
    }

    if (action === "send_message") {
      const issueId = String(body.issueId || "");
      const { data: issue } = await admin.from("qc_issues").select("*").eq("id", issueId).maybeSingle();
      if (!issue) return json({ ok: false, error: "QC case not found." }, 404);
      const { data: original } = await admin.from("bookings").select("first_name, last_name, email, phone").eq("id", issue.booking_id).maybeSingle();
      const message = String(body.message || issue.reclean_message_draft || "").trim();
      if (!message) return json({ ok: false, error: "message required" }, 400);
      const subject = String(body.subject || "About your Novara Cleaning visit");
      const channel = String(body.channel || "both");
      if ((channel === "email" || channel === "both") && original?.email) {
        await sendCustomerEmail(admin, original.email, subject, `<p>${message.replace(/\n/g, "<br/>")}</p>`);
      }
      if ((channel === "sms" || channel === "both") && original?.phone) {
        await sendSms(admin, { toPhone: original.phone, message, type: "confirmation" });
      }
      const now = new Date().toISOString();
      await admin.from("qc_issues").update({
        reclean_message_draft: message,
        reclean_customer_notified_at: issue.reclean_status === "completed" ? issue.reclean_customer_notified_at : now,
        reclean_completion_notified_at: issue.reclean_status === "completed" ? now : issue.reclean_completion_notified_at,
      }).eq("id", issueId);
      await logEvent(admin, issueId, "reclean_message", actor, { channel });
      return json({ ok: true });
    }

    if (action === "report") {
      const settings: RecleanSettings = await loadRecleanSettings(admin);
      const from = String(body.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
      const to = String(body.to || new Date().toISOString().slice(0, 10));
      const { data: recleanIssues } = await admin
        .from("qc_issues")
        .select("id, booking_id, cleaner_id, reclean_status, reclean_classification, reclean_absorbed_cost_cents, reclean_pay_cents, reclean_source, reclean_scope, created_at, reclean_performed_by_cleaner_id, reclean_offered_to_cleaner_id")
        .neq("reclean_status", "none")
        .gte("created_at", `${from}T00:00:00.000Z`)
        .lte("created_at", `${to}T23:59:59.999Z`);
      const issues = (recleanIssues || []) as Record<string, unknown>[];
      const originalIds = [...new Set(issues.map((i) => String(i.booking_id)).filter(Boolean))];
      const { data: originals } = originalIds.length
        ? await admin.from("bookings").select("id, service_type, sqft, customer_id, cleaner_id").in("id", originalIds)
        : { data: [] as Record<string, unknown>[] };
      const origById = new Map((originals || []).map((b: Record<string, unknown>) => [String(b.id), b]));
      const { count: completedJobs } = await admin
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .or("is_reclean.is.false,is_reclean.is.null")
        .gte("service_date", from)
        .lte("service_date", to);

      const byClass: Record<string, number> = { quality_miss: 0, scope_confusion: 0, not_supported: 0, pending: 0, unclassified: 0 };
      const byService = new Map<string, number>();
      const bySize = new Map<string, number>();
      const byCustomer = new Map<string, number>();
      const byOriginalCleaner = new Map<string, { qualityMiss: number; total: number; absorbed: number }>();
      let absorbed = 0;
      for (const i of issues) {
        const cls = String(i.reclean_classification || "unclassified");
        byClass[cls] = (byClass[cls] || 0) + 1;
        absorbed += Number(i.reclean_absorbed_cost_cents || i.reclean_pay_cents || 0) || 0;
        const orig = origById.get(String(i.booking_id));
        const st = String(orig?.service_type || "unknown");
        byService.set(st, (byService.get(st) || 0) + 1);
        const band = sizeBand(Number(orig?.sqft) || 0);
        bySize.set(band, (bySize.get(band) || 0) + 1);
        const cust = String(orig?.customer_id || "");
        if (cust) byCustomer.set(cust, (byCustomer.get(cust) || 0) + 1);
        const cid = String(i.cleaner_id || orig?.cleaner_id || "");
        if (cid) {
          const cur = byOriginalCleaner.get(cid) || { qualityMiss: 0, total: 0, absorbed: 0 };
          cur.total += 1;
          if (cls === "quality_miss") cur.qualityMiss += 1;
          cur.absorbed += Number(i.reclean_absorbed_cost_cents || 0) || 0;
          byOriginalCleaner.set(cid, cur);
        }
      }

      const cleanerIds = [...byOriginalCleaner.keys()];
      const names = new Map<string, string>();
      if (cleanerIds.length) {
        const { data: cs } = await admin.from("cleaners").select("id, first_name, last_name").in("id", cleanerIds);
        for (const c of cs || []) {
          names.set(c.id, `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner");
        }
      }
      const customerIds = [...byCustomer.keys()];
      const customerNames = new Map<string, string>();
      if (customerIds.length) {
        const { data: custs } = await admin.from("customers").select("id, first_name, last_name, email").in("id", customerIds);
        for (const c of custs || []) {
          customerNames.set(c.id, `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.email || "Customer");
        }
      }

      const repeatQualityMiss = [...byOriginalCleaner.entries()]
        .filter(([, v]) => v.qualityMiss >= settings.repeat_quality_miss_threshold)
        .map(([cleanerId, v]) => ({ cleanerId, name: names.get(cleanerId) || "Cleaner", ...v }));
      const serial = [...byCustomer.entries()]
        .filter(([, n]) => n >= settings.serial_requester_threshold)
        .map(([customerId, count]) => ({ customerId, name: customerNames.get(customerId) || "Customer", count }));

      const completed = completedJobs || 0;
      return json({
        ok: true,
        from,
        to,
        completedJobs: completed,
        recleanRequests: issues.length,
        recleanRate: completed ? issues.length / completed : 0,
        byClassification: byClass,
        byServiceType: Object.fromEntries(byService),
        bySizeBand: Object.fromEntries(bySize),
        byCleaner: [...byOriginalCleaner.entries()].map(([cleanerId, v]) => ({
          cleanerId,
          name: names.get(cleanerId) || "Cleaner",
          ...v,
        })),
        absorbedCostCents: absorbed,
        serialRequesters: serial,
        repeatQualityMissCleaners: repeatQualityMiss,
        note: "Repeat quality-miss rows are a coaching signal. No automatic penalty is applied. A high scope-confusion rate is a booking/intake problem, not a cleaning problem.",
      });
    }

    return json({ ok: false, error: `Unknown action '${action}'.` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    const status = msg.includes("Not signed in") ? 401 : msg.includes("only") ? 403 : 400;
    return json({ ok: false, error: msg }, status);
  }
});
