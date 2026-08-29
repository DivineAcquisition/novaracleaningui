// Public tokenized walkthrough form — unique, auto-expiring, auto-saving.
// Resolves to one request/site. Checklist is universal + that property type
// only. Submit feeds the existing walkthrough pipeline (conduct or exclude).

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { loadCommercialConfigServer } from "@/lib/commercial-pricing-server";
import { computeCommercialQuote, windowHoursBetween } from "@/lib/commercial-pricing";
import { loadProposalChecklists } from "@/lib/proposal-request-server";
import {
  exclusionFromAnswers,
  mapAnswersToConduct,
  missingRequired,
  propertyTypeByKey,
  walkthroughChecklistFor,
  WALKTHROUGH_EXCLUSION_CODES,
} from "@/lib/proposal-request";
import { buildWalkthroughPdf } from "@/lib/walkthrough-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXCLUSION_CODES = WALKTHROUGH_EXCLUSION_CODES;

function clock(v: unknown): string | null {
  const raw = String(v ?? "").trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(raw) ? raw : null;
}

async function resolveToken(token: string) {
  const supabase = getAdminSupabase();
  if (!token || token.length < 12) return { supabase, wt: null as Record<string, any> | null, error: "Invalid link." };
  const { data } = await supabase
    .from("commercial_walkthroughs")
    .select("*")
    .eq("assignment_token", token)
    .maybeSingle();
  if (!data) return { supabase, wt: null, error: "This walkthrough link is not valid." };
  const wt = data as Record<string, any>;
  if (wt.token_expires_at && new Date(wt.token_expires_at).getTime() < Date.now() && !wt.token_submitted_at) {
    return { supabase, wt, error: "This walkthrough link has expired. Ask dispatch to resend it." };
  }
  return { supabase, wt, error: null as string | null };
}

async function loadContext(supabase: ReturnType<typeof getAdminSupabase>, wt: Record<string, any>) {
  const catalog = await loadProposalChecklists(supabase);
  const typeKey = String(wt.property_type_key || wt.facility_type_key || "other");
  const type = propertyTypeByKey(catalog, typeKey) || propertyTypeByKey(catalog, "other")!;
  const checklist = walkthroughChecklistFor(catalog, type.key);
  const { data: site } = await supabase
    .from("business_sites")
    .select("id, nickname, address, city, state, zip_code, business_account_id")
    .eq("id", wt.business_site_id)
    .maybeSingle();
  const { data: account } = site?.business_account_id
    ? await supabase.from("business_accounts").select("id, business_name, contact_name, email").eq("id", site.business_account_id).maybeSingle()
    : { data: null };
  const { data: request } = wt.proposal_request_id
    ? await supabase.from("proposal_requests").select("*").eq("id", wt.proposal_request_id).maybeSingle()
    : { data: null };
  const { data: cleaner } = wt.assigned_cleaner_id
    ? await supabase.from("cleaners").select("id, first_name, last_name").eq("id", wt.assigned_cleaner_id).maybeSingle()
    : { data: null };
  return { catalog, type, checklist, site, account, request, cleaner };
}

export async function GET(
  _req: Request,
  { params }: { params: { token: string } },
): Promise<NextResponse> {
  const { supabase, wt, error } = await resolveToken(params.token);
  if (error && !wt) return NextResponse.json({ error }, { status: 404 });
  if (!wt) return NextResponse.json({ error: error || "Not found" }, { status: 404 });
  if (error && !wt.token_submitted_at) return NextResponse.json({ error }, { status: 410 });

  const ctx = await loadContext(supabase, wt);
  return NextResponse.json({
    ok: true,
    expired: Boolean(error),
    submitted: Boolean(wt.token_submitted_at),
    status: wt.status,
    walkthroughId: wt.id,
    propertyType: ctx.type,
    checklist: ctx.checklist,
    answers: wt.checklist_answers || {},
    photos: Array.isArray(wt.photos) ? wt.photos : [],
    scheduledAt: wt.scheduled_at,
    site: {
      nickname: ctx.site?.nickname || wt.site_address,
      address: [ctx.site?.address, ctx.site?.city, ctx.site?.state, ctx.site?.zip_code].filter(Boolean).join(", ") || wt.site_address,
      clientStatedSqft: wt.client_stated_sqft,
    },
    access: {
      name: wt.access_contact_name,
      phone: wt.access_contact_phone,
    },
    account: ctx.account ? { name: ctx.account.business_name, contact: ctx.account.contact_name } : null,
    cleaner: ctx.cleaner
      ? { name: [ctx.cleaner.first_name, ctx.cleaner.last_name].filter(Boolean).join(" ") }
      : { name: wt.conducted_by },
    exclusionCodes: Object.fromEntries(
      Object.entries(EXCLUSION_CODES).filter(([k]) => k !== "none"),
    ),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: { token: string } },
): Promise<NextResponse> {
  const { supabase, wt, error } = await resolveToken(params.token);
  if (!wt) return NextResponse.json({ error: error || "Not found" }, { status: 404 });
  if (error) return NextResponse.json({ error }, { status: 410 });
  if (wt.token_submitted_at || ["conducted", "priced", "excluded", "cancelled"].includes(String(wt.status))) {
    return NextResponse.json({ ok: true, submitted: true });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.answers && typeof body.answers === "object") {
    patch.checklist_answers = { ...(wt.checklist_answers || {}), ...(body.answers as object) };
  }
  if (Array.isArray(body.photos)) {
    patch.photos = body.photos.map((u) => String(u)).filter(Boolean).slice(0, 40);
  }
  const { error: upErr } = await supabase.from("commercial_walkthroughs").update(patch).eq("id", wt.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
  return NextResponse.json({ ok: true, savedAt: patch.updated_at });
}

export async function POST(
  req: Request,
  { params }: { params: { token: string } },
): Promise<NextResponse> {
  const { supabase, wt, error } = await resolveToken(params.token);
  if (!wt) return NextResponse.json({ error: error || "Not found" }, { status: 404 });
  if (error) return NextResponse.json({ error }, { status: 410 });
  if (wt.token_submitted_at) return NextResponse.json({ ok: true, alreadySubmitted: true, status: wt.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const ctx = await loadContext(supabase, wt);
  const answers = {
    ...(wt.checklist_answers || {}),
    ...((body.answers as Record<string, unknown>) || {}),
  };
  if (Array.isArray(body.photos)) answers.photos = body.photos;
  else if (Array.isArray(wt.photos) && wt.photos.length) answers.photos = wt.photos;

  const items = ctx.checklist.all;
  const missing = missingRequired(items, answers);
  const exclusion = exclusionFromAnswers(answers);

  if (exclusion) {
    const note = exclusion.note;
    if (note.length < 10) {
      return NextResponse.json({
        error: "Describe the excluded condition — this is the record of why we cannot price the site.",
        missing: ["exclusion notes"],
      }, { status: 400 });
    }
    if (!EXCLUSION_CODES[exclusion.code] || exclusion.code === "none") {
      return NextResponse.json({ error: "Pick which excluded condition was found." }, { status: 400 });
    }
    return applyExclusion(supabase, wt, ctx, answers, exclusion.code, note);
  }

  if (missing.length) {
    return NextResponse.json({
      error: `A walkthrough isn't complete without every finding the price depends on. Still needed: ${missing.join(", ")}.`,
      missing,
    }, { status: 400 });
  }

  return applyConduct(supabase, wt, ctx, answers);
}

async function applyExclusion(
  supabase: ReturnType<typeof getAdminSupabase>,
  wt: Record<string, any>,
  ctx: Awaited<ReturnType<typeof loadContext>>,
  answers: Record<string, unknown>,
  code: string,
  note: string,
) {
  const siteName = ctx.site?.nickname || "site";
  const actorName = ctx.cleaner?.first_name
    ? [ctx.cleaner.first_name, ctx.cleaner.last_name].filter(Boolean).join(" ")
    : wt.conducted_by || "Walkthrough agent";

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
      walkthrough_id: wt.id,
      site_id: wt.business_site_id,
      account_id: wt.business_account_id,
      stop_reason: code,
      location: siteName,
      reported_by: actorName,
    },
  }).select("id").maybeSingle();

  const now = new Date().toISOString();
  const mapped = mapAnswersToConduct(ctx.type, ctx.checklist.all, answers);
  const { error } = await supabase.from("commercial_walkthroughs").update({
    status: "excluded",
    exclusion_code: code,
    exclusion_note: note,
    exclusion_qc_issue_id: (issue as { id?: string } | null)?.id ?? null,
    excluded_at: now,
    checklist_answers: answers,
    findings_extra: mapped.findingsExtra,
    photos: Array.isArray(answers.photos) ? answers.photos : wt.photos,
    token_submitted_at: now,
    updated_at: now,
  }).eq("id", wt.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase.from("business_sites").update({
    excluded_at: now,
    exclusion_code: code,
    exclusion_note: `${EXCLUSION_CODES[code]} — ${note}`,
    updated_at: now,
  }).eq("id", wt.business_site_id);

  if (wt.proposal_request_id) {
    await supabase.from("proposal_requests").update({
      status: "excluded",
      updated_at: now,
    }).eq("id", wt.proposal_request_id);
  }

  await supabase.from("events").insert({
    event_type: "walkthrough.excluded",
    source: "walkthrough-token",
    summary: `Walkthrough at ${siteName} STOPPED — ${EXCLUSION_CODES[code]}. ${note} No price will be produced; route this out.`,
    data: { walkthrough_id: wt.id, site_id: wt.business_site_id, exclusion_code: code },
  });

  await attachPdfAndDrive(supabase, wt, ctx, answers, true, `${EXCLUSION_CODES[code]} — ${note}`);

  return NextResponse.json({ ok: true, excluded: true, qcIssueId: (issue as { id?: string } | null)?.id ?? null });
}

async function applyConduct(
  supabase: ReturnType<typeof getAdminSupabase>,
  wt: Record<string, any>,
  ctx: Awaited<ReturnType<typeof loadContext>>,
  answers: Record<string, unknown>,
) {
  const { conduct, findingsExtra } = mapAnswersToConduct(ctx.type, ctx.checklist.all, answers);
  const photos = Array.isArray(conduct.photos) ? conduct.photos : (Array.isArray(answers.photos) ? answers.photos : []);
  const actorName = ctx.cleaner?.first_name
    ? [ctx.cleaner.first_name, ctx.cleaner.last_name].filter(Boolean).join(" ")
    : wt.conducted_by || "Walkthrough agent";

  const patch: Record<string, unknown> = {
    sqft: conduct.confirmedSqft,
    facility_type_key: conduct.facilityTypeKey || ctx.type.facilityTypeKey,
    scope_level: conduct.scopeLevel,
    condition_level: conduct.conditionLevel,
    restroom_count: conduct.restroomCount,
    breakroom_count: conduct.breakroomCount ?? 0,
    floor_count: conduct.floorCount,
    obstacle_density: conduct.obstacleDensity,
    obstacles: conduct.obstacles,
    floor_types: conduct.floorTypes,
    badge_required: conduct.badgeRequired === true,
    loading_dock_notes: conduct.loadingDockNotes,
    after_hours_access_notes: conduct.afterHoursAccessNotes,
    service_window_start: clock(conduct.serviceWindowStart),
    service_window_end: clock(conduct.serviceWindowEnd),
    service_window_notes: conduct.serviceWindowNotes,
    recommended_crew_size: conduct.recommendedCrewSize,
    photos,
    checklist_answers: answers,
    findings_extra: findingsExtra,
    notes: [wt.notes, answers.obstacles].filter(Boolean).join("\n").slice(0, 4000) || wt.notes,
    conducted_on: new Date().toISOString().slice(0, 10),
    conducted_at: new Date().toISOString(),
    conducted_by: actorName,
    token_submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "conducted",
  };

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
      error: `A walkthrough isn't complete without every finding the price depends on. Still needed: ${missing.join(", ")}.`,
      missing,
    }, { status: 400 });
  }

  const config = await loadCommercialConfigServer(supabase);
  const windowHours = windowHoursBetween(
    merged.service_window_start as string,
    merged.service_window_end as string,
  );
  const quote = computeCommercialQuote(config, {
    sqft: Number(merged.sqft) || 0,
    facilityTypeKey: String(merged.facility_type_key || ""),
    scopeLevel: String(merged.scope_level || "standard"),
    windowHours,
  });
  if (quote.ok) {
    patch.formula_price_cents = quote.formulaCents;
    patch.estimate_low_cents = quote.estimateLowCents;
    patch.estimate_high_cents = quote.estimateHighCents;
  }

  const { error } = await supabase.from("commercial_walkthroughs").update(patch).eq("id", wt.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (wt.proposal_request_id) {
    await supabase.from("proposal_requests").update({
      status: "walkthrough_conducted",
      updated_at: new Date().toISOString(),
    }).eq("id", wt.proposal_request_id);
  }

  const siteName = ctx.site?.nickname || "site";
  const stated = Number(wt.client_stated_sqft) || 0;
  const confirmed = Number(merged.sqft) || 0;
  const sqftNote = stated && confirmed && stated !== confirmed
    ? ` Confirmed ${confirmed.toLocaleString()} sq ft against ${stated.toLocaleString()} stated by the client.`
    : "";

  await supabase.from("events").insert({
    event_type: "walkthrough.conducted",
    source: "walkthrough-token",
    summary: `Walkthrough conducted at ${siteName} by ${actorName}.${sqftNote} Findings captured — a firm price is still to be set.`,
    data: {
      walkthrough_id: wt.id,
      site_id: wt.business_site_id,
      proposal_request_id: wt.proposal_request_id,
      confirmed_sqft: confirmed,
      property_type_key: ctx.type.key,
    },
  });

  await attachPdfAndDrive(supabase, { ...wt, ...patch }, ctx, answers, false);

  return NextResponse.json({ ok: true, excluded: false, anchor: quote });
}

async function attachPdfAndDrive(
  supabase: ReturnType<typeof getAdminSupabase>,
  wt: Record<string, any>,
  ctx: Awaited<ReturnType<typeof loadContext>>,
  answers: Record<string, unknown>,
  excluded: boolean,
  exclusionNote?: string,
) {
  try {
    const photos = Array.isArray(answers.photos) ? answers.photos as string[] : (Array.isArray(wt.photos) ? wt.photos : []);
    const bytes = await buildWalkthroughPdf({
      type: ctx.type,
      siteLabel: ctx.site?.nickname || "Site",
      address: [ctx.site?.address, ctx.site?.city, ctx.site?.state, ctx.site?.zip_code].filter(Boolean).join(", ") || wt.site_address || "",
      requesterName: ctx.request?.requester_name || ctx.account?.contact_name || "",
      company: ctx.request?.requester_company || ctx.account?.business_name || "",
      conductorName: ctx.cleaner
        ? [ctx.cleaner.first_name, ctx.cleaner.last_name].filter(Boolean).join(" ")
        : wt.conducted_by || "",
      conductedOn: new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" }),
      excluded,
      exclusionNote,
      universal: ctx.checklist.universal,
      typeSpecific: ctx.checklist.typeSpecific,
      answers,
      photoCount: photos.length,
    });
    const key = `walkthroughs/${wt.id}/walkthrough-${new Date().toISOString().slice(0, 10)}.pdf`;
    const { error: upErr } = await supabase.storage.from("cleaner-job-photos").upload(key, bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (!upErr) {
      const url = supabase.storage.from("cleaner-job-photos").getPublicUrl(key).data.publicUrl;
      await supabase.from("commercial_walkthroughs").update({ pdf_url: url }).eq("id", wt.id);
    }
  } catch (e) {
    console.error("[walkthrough-token] pdf failed", e instanceof Error ? e.message : e);
  }

  try {
    await supabase.functions.invoke("walkthrough-drive-mirror", {
      body: { walkthroughId: wt.id },
    });
  } catch {
    /* Drive is best-effort — photos already live under walkthroughs/ in storage */
  }
}
