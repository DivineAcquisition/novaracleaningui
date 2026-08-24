// ─── /api/admin/walkthroughs ───────────────────────────────────────────────
//
// The walkthrough pipeline: Request → Scheduled → Conducted → Firm Price Set,
// with Excluded as the other ending.
//
//   GET  ?view=pipeline     every walkthrough by stage, stalled ones first
//        ?view=variance     sites whose real service time has drifted from
//                           what their walkthrough assumed
//        ?id=…              one walkthrough: findings, photos, the formula
//                           anchor recomputed live, and its site's history
//        ?siteId=…          a site's pricing state and every walkthrough it
//                           has ever had
//
//   POST { action: … }
//     request     open a walkthrough (new site, disputed rate, or manual)
//     schedule    date/time, conductor, client contact for access
//     conduct     record the structured findings — refused unless complete
//     exclude     a condition we do not service: stops the pipeline, routes to
//                 QC, and records on the Site why pricing stopped
//     set_price   the firm price, anchored on the formula; any move off it
//                 needs a reason. Writes the outcome onto the Site, which is
//                 what the booking flow reads.
//     rewalk      open a fresh pipeline on a priced site, prior one retained
//     cancel      abandon a pipeline that is not going anywhere
//
// The database enforces the parts that matter — completeness of findings, a
// reason for any adjustment, an explanation for any exclusion — so these
// handlers translate rather than police.
//
// Admin/VA only.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { loadCommercialConfigServer } from "@/lib/commercial-pricing-server";
import {
  computeCommercialQuote,
  recommendCrewSize,
  windowHoursBetween,
} from "@/lib/commercial-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WT_COLS = "*";

/** Conditions we do not service. A finding here ends the pipeline. */
const EXCLUSION_CODES: Record<string, string> = {
  mold_over_threshold: "Mold beyond minor surface area",
  active_infestation: "Active pest infestation or bed bugs",
  biohazard: "Biohazard material",
  structural_hazard: "Structural hazard",
  other: "Other condition outside our scope",
};

async function guard(req: Request) {
  try {
    return { principal: await requireAdmin(req), failure: null as NextResponse | null };
  } catch (e) {
    const err = e as AdminAuthError;
    return {
      principal: null,
      failure: NextResponse.json({ error: err.message }, { status: err.status || 401 }),
    };
  }
}

const s = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max) || null;
const int = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
function isoDate(v: unknown): string | null {
  const raw = String(v ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}
function clock(v: unknown): string | null {
  const raw = String(v ?? "").trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(raw) ? raw : null;
}

/**
 * The formula's answer for a walkthrough's confirmed findings.
 *
 * Always recomputed rather than read back from the row: the anchor shown to
 * whoever is pricing has to reflect today's rate table, not whatever it was
 * when the visit happened.
 */
async function anchorFor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  wt: Record<string, unknown>,
) {
  const config = await loadCommercialConfigServer(supabase);
  const sqft = Number(wt.sqft) || Number(wt.client_stated_sqft) || 0;
  const windowHours = windowHoursBetween(
    wt.service_window_start as string,
    wt.service_window_end as string,
  );
  const quote = computeCommercialQuote(config, {
    sqft,
    facilityTypeKey: String(wt.facility_type_key || ""),
    scopeLevel: String(wt.scope_level || "standard"),
    windowHours,
  });
  return { config, quote, windowHours };
}

export async function GET(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const supabase = getAdminSupabase();
  const url = new URL(req.url);
  const view = url.searchParams.get("view");
  const id = url.searchParams.get("id");
  const siteId = url.searchParams.get("siteId");

  if (view === "variance") {
    const { data, error } = await supabase
      .from("commercial_site_variance_v1")
      .select("*")
      .gt("samples", 0)
      .order("rewalkthrough_suggested", { ascending: false })
      .order("avg_variance_pct", { ascending: false })
      .limit(300);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, sites: data || [] });
  }

  if (id) {
    const { data: wt, error } = await supabase
      .from("commercial_walkthroughs").select(WT_COLS).eq("id", id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!wt) return NextResponse.json({ error: "Walkthrough not found." }, { status: 404 });

    const row = wt as Record<string, unknown>;
    const { quote, windowHours } = await anchorFor(supabase, row);
    const { data: history } = await supabase
      .from("commercial_walkthroughs")
      .select("id, status, conducted_on, conducted_by, sqft, firm_price_cents, formula_price_cents, price_adjustment_reason, exclusion_code, requested_at")
      .eq("business_site_id", row.business_site_id)
      .order("requested_at", { ascending: false });
    const { data: pricingState } = await supabase.rpc("commercial_site_pricing_state", {
      p_site_id: row.business_site_id,
    });

    return NextResponse.json({
      ok: true,
      walkthrough: wt,
      anchor: quote,
      windowHours,
      history: history || [],
      pricingState: pricingState || null,
      exclusionCodes: EXCLUSION_CODES,
    });
  }

  if (siteId) {
    const [stateRes, historyRes] = await Promise.all([
      supabase.rpc("commercial_site_pricing_state", { p_site_id: siteId }),
      supabase.from("commercial_walkthroughs").select(WT_COLS)
        .eq("business_site_id", siteId).order("requested_at", { ascending: false }),
    ]);
    return NextResponse.json({
      ok: true,
      pricingState: stateRes.data || null,
      walkthroughs: historyRes.data || [],
    });
  }

  // Pipeline board. stage_rank puts conducted-pending-price first, because a
  // deal that stalls after the visit is the one that stalls silently.
  const { data, error } = await supabase
    .from("walkthrough_pipeline_v1")
    .select("*")
    .order("stage_rank", { ascending: true })
    .order("requested_at", { ascending: true })
    .limit(400);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, walkthroughs: data || [], exclusionCodes: EXCLUSION_CODES });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure) return failure;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const action = String(body.action || "");
  const actorName = s(body.actorName, 120) || principal?.email || "Admin";

  // ── Open a pipeline ────────────────────────────────────────────────────
  if (action === "request" || action === "rewalk") {
    const siteId = String(body.siteId || "").trim();
    if (!siteId) return NextResponse.json({ error: "siteId is required." }, { status: 400 });

    const { data: site } = await supabase
      .from("business_sites")
      .select("id, business_account_id, nickname, address, city, state, zip_code, sqft, facility_type, facility_type_key, scope_level, walkthrough_id")
      .eq("id", siteId).maybeSingle();
    if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
    const siteRow = site as Record<string, any>;

    const reason = action === "rewalk"
      ? (s(body.reason, 40) || "performance_variance")
      : (s(body.reason, 40) || "manual");

    const { data: created, error } = await supabase
      .from("commercial_walkthroughs")
      .insert({
        business_account_id: siteRow.business_account_id,
        business_site_id: siteId,
        status: "requested",
        request_reason: reason,
        requested_by: principal?.userId ?? null,
        requested_by_name: actorName,
        client_stated_sqft: int(body.clientStatedSqft) ?? siteRow.sqft ?? null,
        client_stated_facility_type: s(body.clientStatedFacilityType, 80) || siteRow.facility_type || null,
        facility_type_key: s(body.facilityTypeKey, 40) || siteRow.facility_type_key || null,
        scope_level: siteRow.scope_level || null,
        site_address: [siteRow.address, siteRow.city, siteRow.state, siteRow.zip_code].filter(Boolean).join(", ") || null,
        access_contact_name: s(body.accessContactName, 120),
        access_contact_phone: s(body.accessContactPhone, 40),
        access_contact_email: s(body.accessContactEmail, 200),
        supersedes_walkthrough_id: action === "rewalk" ? (siteRow.walkthrough_id || null) : null,
        variance_trigger: action === "rewalk" && body.varianceTrigger ? body.varianceTrigger : null,
        notes: s(body.notes, 2000),
      })
      .select(WT_COLS)
      .maybeSingle();
    if (error) {
      if (/commercial_walkthroughs_one_open/.test(error.message)) {
        return NextResponse.json(
          { error: "This site already has a walkthrough in progress. Finish or cancel it before opening another — two open pipelines means two prices under negotiation." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await supabase.from("events").insert({
      event_type: "walkthrough.requested",
      source: "admin-walkthroughs",
      summary: action === "rewalk"
        ? `Re-walkthrough requested for ${siteRow.nickname} by ${actorName} — the site's real service time has drifted from what the last walkthrough assumed.`
        : `Walkthrough requested for ${siteRow.nickname} by ${actorName} (${reason.replace(/_/g, " ")}).`,
      data: { site_id: siteId, account_id: siteRow.business_account_id, reason, rewalk: action === "rewalk" },
    });

    return NextResponse.json({ ok: true, walkthrough: created });
  }

  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const { data: existing } = await supabase
    .from("commercial_walkthroughs").select(WT_COLS).eq("id", id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Walkthrough not found." }, { status: 404 });
  const wt = existing as Record<string, any>;

  const { data: site } = await supabase
    .from("business_sites").select("id, nickname, business_account_id").eq("id", wt.business_site_id).maybeSingle();
  const siteName = (site as { nickname?: string } | null)?.nickname || "site";

  // ── Schedule ───────────────────────────────────────────────────────────
  if (action === "schedule") {
    const scheduledAt = s(body.scheduledAt, 40);
    const conductor = s(body.conductorName, 120);
    if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
      return NextResponse.json({ error: "A date and time for the visit is required." }, { status: 400 });
    }
    if (!conductor) {
      return NextResponse.json(
        { error: "Name who is conducting it — whoever walks the building is representing our pricing to the client." },
        { status: 400 },
      );
    }
    const accessName = s(body.accessContactName, 120) || wt.access_contact_name;
    if (!accessName) {
      return NextResponse.json(
        { error: "A client contact for site access is required — a scheduled visit nobody can get into is not scheduled." },
        { status: 400 },
      );
    }

    const { error } = await supabase.from("commercial_walkthroughs").update({
      status: "scheduled",
      scheduled_at: scheduledAt,
      scheduled_for: scheduledAt.slice(0, 10),
      conducted_by: conductor,
      conductor_user_id: s(body.conductorUserId, 40),
      conductor_email: s(body.conductorEmail, 200),
      conductor_phone: s(body.conductorPhone, 40),
      access_contact_name: accessName,
      access_contact_phone: s(body.accessContactPhone, 40) || wt.access_contact_phone,
      access_contact_email: s(body.accessContactEmail, 200) || wt.access_contact_email,
      client_access_confirmed: body.clientAccessConfirmed === true,
      reminder_sent_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await supabase.from("events").insert({
      event_type: "walkthrough.scheduled",
      source: "admin-walkthroughs",
      summary: `Walkthrough at ${siteName} scheduled for ${new Date(scheduledAt).toLocaleString("en-US", { timeZone: "America/New_York" })} — ${conductor} conducting, ${accessName} providing access.`,
      data: { walkthrough_id: id, site_id: wt.business_site_id, scheduled_at: scheduledAt, conductor },
    });
    return NextResponse.json({ ok: true });
  }

  // ── Conducted: the structured findings ─────────────────────────────────
  if (action === "conduct") {
    const patch: Record<string, unknown> = {
      sqft: int(body.confirmedSqft),
      facility_type_key: s(body.facilityTypeKey, 40),
      scope_level: s(body.scopeLevel, 20),
      condition_level: s(body.conditionLevel, 20),
      restroom_count: int(body.restroomCount),
      breakroom_count: int(body.breakroomCount),
      floor_count: int(body.floorCount),
      obstacle_density: s(body.obstacleDensity, 20),
      obstacles: s(body.obstacles, 2000),
      floor_types: s(body.floorTypes, 500),
      special_equipment: s(body.specialEquipment, 1000),
      required_equipment: Array.isArray(body.requiredEquipment)
        ? body.requiredEquipment.map((e: unknown) => String(e).trim()).filter(Boolean).slice(0, 12)
        : [],
      badge_required: body.badgeRequired === true,
      alarm_code: s(body.alarmCode, 60),
      loading_dock_notes: s(body.loadingDockNotes, 1000),
      after_hours_access_notes: s(body.afterHoursAccessNotes, 1000),
      security_contact_name: s(body.securityContactName, 120),
      security_contact_phone: s(body.securityContactPhone, 40),
      security_complexity: s(body.securityComplexity, 1000),
      service_window_start: clock(body.serviceWindowStart),
      service_window_end: clock(body.serviceWindowEnd),
      service_window_notes: s(body.serviceWindowNotes, 1000),
      recommended_crew_size: int(body.recommendedCrewSize),
      photos: Array.isArray(body.photos)
        ? body.photos.map((p: unknown) => String(p)).filter(Boolean).slice(0, 40)
        : (wt.photos || []),
      notes: s(body.notes, 4000),
      conducted_on: isoDate(body.conductedOn) || new Date().toISOString().slice(0, 10),
      conducted_at: new Date().toISOString(),
      conducted_by: s(body.conductedBy, 120) || wt.conducted_by || actorName,
      updated_at: new Date().toISOString(),
    };

    // Name what is missing rather than letting the constraint speak. The
    // database still has the final say; this is so the person filling the form
    // knows which field to go back to.
    const merged = { ...wt, ...patch };
    const missing: string[] = [];
    if (!Number(merged.sqft)) missing.push("confirmed square footage");
    if (!merged.facility_type_key) missing.push("facility type");
    if (!merged.scope_level) missing.push("scope level");
    if (!merged.condition_level) missing.push("condition assessment");
    if (merged.restroom_count == null) missing.push("restroom count");
    if (merged.breakroom_count == null) missing.push("breakroom count");
    if (merged.floor_count == null) missing.push("floor count");
    if (!merged.obstacle_density) missing.push("obstacle density");
    if (!merged.floor_types) missing.push("floor types");
    if (!merged.service_window_start || !merged.service_window_end) missing.push("service window");
    if (!Number(merged.recommended_crew_size)) missing.push("recommended crew size");
    if (!Array.isArray(merged.photos) || merged.photos.length === 0) missing.push("condition photos");
    if (missing.length) {
      return NextResponse.json({
        ok: false,
        error: `A walkthrough isn't complete without every finding the price depends on. Still needed: ${missing.join(", ")}.`,
        missing,
      }, { status: 400 });
    }

    // The anchor as of the confirmed findings, stored so the record shows what
    // the formula said at the moment it was priced against.
    const { quote } = await anchorFor(supabase, merged);
    if (quote.ok) {
      patch.formula_price_cents = quote.formulaCents;
      patch.estimate_low_cents = quote.estimateLowCents;
      patch.estimate_high_cents = quote.estimateHighCents;
    }
    patch.status = "conducted";

    const { error } = await supabase.from("commercial_walkthroughs").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const stated = Number(wt.client_stated_sqft) || 0;
    const confirmed = Number(merged.sqft) || 0;
    const sqftNote = stated && confirmed && stated !== confirmed
      ? ` Confirmed ${confirmed.toLocaleString()} sq ft against ${stated.toLocaleString()} stated by the client.`
      : "";

    await supabase.from("events").insert({
      event_type: "walkthrough.conducted",
      source: "admin-walkthroughs",
      summary: `Walkthrough conducted at ${siteName} by ${merged.conducted_by}.${sqftNote} Findings captured — a firm price is still to be set.`,
      data: {
        walkthrough_id: id, site_id: wt.business_site_id,
        confirmed_sqft: confirmed, client_stated_sqft: stated || null,
        condition: merged.condition_level, crew: merged.recommended_crew_size,
        formula_price_cents: quote.ok ? quote.formulaCents : null,
      },
    });

    return NextResponse.json({ ok: true, anchor: quote });
  }

  // ── Excluded: a stop, not a scope adjustment ───────────────────────────
  if (action === "exclude") {
    const code = String(body.exclusionCode || "");
    const note = s(body.exclusionNote, 2000) || "";
    if (!EXCLUSION_CODES[code]) {
      return NextResponse.json({ error: "Pick which excluded condition was found." }, { status: 400 });
    }
    if (note.length < 10) {
      return NextResponse.json(
        { error: "Describe what was found — this is the record of why we could not price the site, and it is what the client will be told." },
        { status: 400 },
      );
    }

    // Route into the existing QC handling, the same place a cleaner's
    // stop-and-report lands. An exclusion found on a walkthrough is the same
    // category of finding, discovered earlier.
    const { data: issue } = await supabase.from("qc_issues").insert({
      issue_type: "site_finding",
      severity: "critical",
      status: "open",
      description:
        `Walkthrough exclusion at ${siteName} — ${EXCLUSION_CODES[code]}. ${note} ` +
        `Pricing stopped; the site is not serviceable until this is resolved or referred out.`,
      details: {
        source: "walkthrough",
        finding_type: code,
        walkthrough_id: id,
        site_id: wt.business_site_id,
        account_id: wt.business_account_id,
        stop_reason: code,
        location: siteName,
        reported_by: actorName,
      },
    }).select("id").maybeSingle();

    const { error } = await supabase.from("commercial_walkthroughs").update({
      status: "excluded",
      exclusion_code: code,
      exclusion_note: note,
      exclusion_qc_issue_id: (issue as { id?: string } | null)?.id ?? null,
      excluded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // The Site carries the reason, so anyone opening it later sees why there
    // is no price rather than assuming nobody got round to it.
    await supabase.from("business_sites").update({
      excluded_at: new Date().toISOString(),
      exclusion_code: code,
      exclusion_note: `${EXCLUSION_CODES[code]} — ${note}`,
      updated_at: new Date().toISOString(),
    }).eq("id", wt.business_site_id);

    await supabase.from("events").insert({
      event_type: "walkthrough.excluded",
      source: "admin-walkthroughs",
      summary: `Walkthrough at ${siteName} STOPPED — ${EXCLUSION_CODES[code]}. ${note} No price will be produced; route this out.`,
      data: {
        walkthrough_id: id, site_id: wt.business_site_id, exclusion_code: code,
        qc_issue_id: (issue as { id?: string } | null)?.id ?? null,
      },
    });

    return NextResponse.json({ ok: true, qcIssueId: (issue as { id?: string } | null)?.id ?? null });
  }

  // ── Firm price set ─────────────────────────────────────────────────────
  if (action === "set_price") {
    if (wt.status !== "conducted" && wt.status !== "priced") {
      return NextResponse.json(
        { error: "A price comes from findings. Record the walkthrough's findings first." },
        { status: 409 },
      );
    }
    const firmPriceCents = int(body.firmPriceCents) || 0;
    if (firmPriceCents <= 0) {
      return NextResponse.json({ error: "A firm price is required." }, { status: 400 });
    }

    const { quote } = await anchorFor(supabase, wt);
    const anchorCents = quote.ok ? quote.formulaCents : null;
    const reason = s(body.adjustmentReason, 2000) || "";
    if (anchorCents != null && firmPriceCents !== anchorCents && reason.length < 10) {
      const delta = firmPriceCents - anchorCents;
      return NextResponse.json({
        error:
          `This is ${delta > 0 ? "above" : "below"} the formula anchor by $${(Math.abs(delta) / 100).toFixed(2)}. ` +
          `Say why — obstacle density, access requirements, condition — so the rate is defensible later.`,
        anchorCents,
      }, { status: 400 });
    }

    const crew = int(body.recommendedCrewSize) || Number(wt.recommended_crew_size) || null;
    const nowIso = new Date().toISOString();

    const { error } = await supabase.from("commercial_walkthroughs").update({
      status: "priced",
      firm_price_cents: firmPriceCents,
      formula_price_cents: anchorCents,
      estimate_low_cents: quote.ok ? quote.estimateLowCents : wt.estimate_low_cents,
      estimate_high_cents: quote.ok ? quote.estimateHighCents : wt.estimate_high_cents,
      price_adjustment_reason: anchorCents != null && firmPriceCents !== anchorCents ? reason : null,
      recommended_crew_size: crew,
      priced_at: nowIso,
      priced_by: principal?.userId ?? null,
      priced_by_name: actorName,
      updated_at: nowIso,
    }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // The Site is what the booking flow reads. Writing the outcome here is
    // what turns "we priced it" into "it can be booked" — and it carries the
    // findings across: confirmed square footage, scope, crew, access, window,
    // and the equipment the building demands.
    const sitePatch: Record<string, unknown> = {
      firm_price_cents: firmPriceCents,
      recommended_crew_size: crew,
      walkthrough_id: id,
      pricing_confirmed_at: nowIso,
      sqft: Number(wt.sqft) || undefined,
      facility_type_key: wt.facility_type_key || undefined,
      scope_level: wt.scope_level || undefined,
      restrooms: wt.restroom_count ?? undefined,
      breakrooms: wt.breakroom_count ?? undefined,
      floors: wt.floor_count ?? undefined,
      badge_required: wt.badge_required === true,
      alarm_code: wt.alarm_code || undefined,
      security_contact_name: wt.security_contact_name || undefined,
      security_contact_phone: wt.security_contact_phone || undefined,
      loading_dock_notes: wt.loading_dock_notes || undefined,
      after_hours_access_notes: wt.after_hours_access_notes || undefined,
      service_window_start: wt.service_window_start || undefined,
      service_window_end: wt.service_window_end || undefined,
      required_equipment: Array.isArray(wt.required_equipment) ? wt.required_equipment : [],
      // A site that was excluded and has since been priced is no longer
      // excluded — leaving the old reason would be actively misleading.
      excluded_at: null,
      exclusion_code: null,
      exclusion_note: null,
      updated_at: nowIso,
    };
    for (const k of Object.keys(sitePatch)) {
      if (sitePatch[k] === undefined) delete sitePatch[k];
    }
    const { error: siteErr } = await supabase.from("business_sites")
      .update(sitePatch).eq("id", wt.business_site_id);
    if (siteErr) return NextResponse.json({ error: siteErr.message }, { status: 400 });

    const adjustment = anchorCents != null && firmPriceCents !== anchorCents
      ? ` (anchor $${(anchorCents / 100).toFixed(2)}; adjusted — ${reason})`
      : " (matches the formula anchor)";
    await supabase.from("events").insert({
      event_type: "walkthrough.priced",
      source: "admin-walkthroughs",
      summary: `${siteName} priced at $${(firmPriceCents / 100).toFixed(2)} by ${actorName}${adjustment}. The site is now eligible for booking, subject to the account's COI and agreement.`,
      data: {
        walkthrough_id: id, site_id: wt.business_site_id,
        firm_price_cents: firmPriceCents, formula_price_cents: anchorCents,
        adjustment_reason: reason || null, recommended_crew_size: crew,
      },
    });

    const { data: pricingState } = await supabase.rpc("commercial_site_pricing_state", {
      p_site_id: wt.business_site_id,
    });
    return NextResponse.json({ ok: true, pricingState: pricingState || null });
  }

  if (action === "cancel") {
    const { error } = await supabase.from("commercial_walkthroughs").update({
      status: "cancelled",
      notes: [wt.notes, s(body.reason, 500)].filter(Boolean).join("\n"),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

/**
 * Crew size for a set of findings — exposed so the conduct form can suggest a
 * number from confirmed square footage, scope, and the window actually
 * available, rather than asking someone to guess.
 */
export async function PUT(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const config = await loadCommercialConfigServer(supabase);
  const windowHours = windowHoursBetween(clock(body.serviceWindowStart), clock(body.serviceWindowEnd));
  const sqft = int(body.confirmedSqft) || 0;
  const scopeLevel = String(body.scopeLevel || "standard");

  const crew = recommendCrewSize(config, { sqft, scopeLevel, windowHours });
  const quote = computeCommercialQuote(config, {
    sqft,
    facilityTypeKey: String(body.facilityTypeKey || ""),
    scopeLevel,
    windowHours,
  });

  return NextResponse.json({ ok: true, crew, anchor: quote, windowHours });
}
