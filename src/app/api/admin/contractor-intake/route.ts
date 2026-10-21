// Admin controls for contractor intake and Lead Cleaner. Legal wording stays
// Draft until someone marks it Reviewed.

import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  INTAKE_SETTINGS_KEY,
  INTAKE_WORDING_KEY,
  mergeIntakeSettings,
  type IntakeSettings,
} from "@/lib/contractor-intake/settings";
import { INTAKE_WORDING, WORDING_STATUS_LABEL, type WordingVersion } from "@/lib/contractor-intake/wording";
import { complianceDashboard, countByStage, type DashboardRow } from "@/lib/contractor-intake/verification";
import { leadEligible, reviewLeadAssignment, type ReliabilityRecord } from "@/lib/contractor-intake/lead";
import { reviewLeadApplication } from "@/lib/contractor-intake/lead-application";
import { applicantMessage } from "@/lib/contractor-intake/messages";
import { canSendFinalAdverse, openPreAdverse } from "@/lib/contractor-intake/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadSettings(supabase: ReturnType<typeof getAdminSupabase>): Promise<IntakeSettings> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", INTAKE_SETTINGS_KEY).maybeSingle();
  return mergeIntakeSettings(data?.value && typeof data.value === "object" ? data.value as Partial<IntakeSettings> : null);
}

async function loadWording(supabase: ReturnType<typeof getAdminSupabase>): Promise<WordingVersion[]> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", INTAKE_WORDING_KEY).maybeSingle();
  const stored = Array.isArray(data?.value) ? data.value as WordingVersion[] : [];
  if (!stored.length) return INTAKE_WORDING;
  return INTAKE_WORDING.map((seed) => stored.find((row) => row.id === seed.id) || seed);
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (err) {
    const error = err as AdminAuthError;
    return NextResponse.json({ error: error.message }, { status: error.status || 401 });
  }
  const supabase = getAdminSupabase();
  const settings = await loadSettings(supabase);
  const wording = await loadWording(supabase);
  const applicantSelect = await supabase
    .from("cleaner_applicants")
    .select("id, full_name, email, stage, intake_stage, intake_decision, created_at, reapply_on")
    .order("created_at", { ascending: true })
    .limit(200);
  const applicants = (applicantSelect.error
    ? (await supabase.from("cleaner_applicants").select("id, full_name, email, stage, created_at").order("created_at", { ascending: true }).limit(200)).data
    : applicantSelect.data) as Array<{ intake_stage?: string | null; stage?: string | null }> | null;
  const stages = (applicants || []).map((row) => String(row.intake_stage || row.stage || "applied"));
  const cleanerSelect = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, status, approved, created_at, novara_score, completed_bookings, kit_confirmed, lead_status, lead_track, intake_flow, intake_record, identity_image_delete_at, identity_images_deleted_at")
    .eq("status", "active")
    .limit(300);
  const cleaners = cleanerSelect.error
    ? (await supabase.from("cleaners").select("id, first_name, last_name, status, approved, created_at, novara_score").eq("status", "active").limit(300)).data
    : cleanerSelect.data;
  const rows = (cleaners || []) as Array<Record<string, unknown>>;
  const eligible = rows.filter((row) => {
    const created = row.created_at ? Date.parse(String(row.created_at)) : Date.now();
    const tenureDays = Math.floor((Date.now() - created) / 86_400_000);
    const record: ReliabilityRecord = {
      active: String(row.status) === "active" && row.approved !== false,
      inProbation: tenureDays < settings.leadMinTenureDays,
      tenureDays,
      completedJobs: Number(row.completed_bookings) || 0,
      novaraScore: Number(row.novara_score) || 0,
      noShows: 0,
      lateCancellations: 0,
      openComplaints: 0,
      openQcCases: 0,
      vehicleVerified: true,
      kitConfirmed: row.kit_confirmed !== false,
    };
    return leadEligible(record, settings).ok && !row.lead_status;
  });
  const dashboardRows: DashboardRow[] = rows.map((row) => ({
    id: String(row.id),
    active: String(row.status) === "active",
    consentDraft: wording.some((item) => item.status !== "reviewed"),
    adverseWaitOpen: false,
    reviewOverdue: false,
    imagesOverdue: Boolean(row.identity_image_delete_at) && !row.identity_images_deleted_at && Date.parse(String(row.identity_image_delete_at)) < Date.now(),
    complianceComplete: row.intake_flow !== "automated" || (row.intake_record as { complianceComplete?: boolean } | null)?.complianceComplete === true,
  }));
  return NextResponse.json({
    ok: true,
    wordingStatus: WORDING_STATUS_LABEL,
    settings,
    wording,
    counts: countByStage(stages),
    needsReview: (applicants || []).filter((row) => row.intake_stage === "needs_review" || row.stage === "needs_review"),
    eligible,
    assignment: reviewLeadAssignment(settings),
    dashboard: complianceDashboard(dashboardRows),
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  let admin: { email: string };
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    const error = err as AdminAuthError;
    return NextResponse.json({ error: error.message }, { status: error.status || 401 });
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "");
  const supabase = getAdminSupabase();
  const settings = await loadSettings(supabase);

  if (action === "save_settings") {
    const next = mergeIntakeSettings(body.settings as Partial<IntakeSettings>);
    const { error } = await supabase.from("app_settings").upsert({ key: INTAKE_SETTINGS_KEY, value: next });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, settings: next });
  }

  if (action === "mark_reviewed") {
    const wording = await loadWording(supabase);
    const id = String(body.id || "");
    const next = wording.map((row) => row.id === id ? { ...row, status: "reviewed" as const } : row);
    if (!next.some((row) => row.id === id)) return NextResponse.json({ error: "Unknown wording." }, { status: 404 });
    const { error } = await supabase.from("app_settings").upsert({ key: INTAKE_WORDING_KEY, value: next });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, wording: next });
  }

  if (action === "open_lead_role") {
    const next = mergeIntakeSettings({ ...settings, leadRoleOpenToPublic: true });
    await supabase.from("app_settings").upsert({ key: INTAKE_SETTINGS_KEY, value: next });
    return NextResponse.json({ ok: true, settings: next });
  }

  if (action === "lead_decision") {
    const reviewed = reviewLeadApplication({
      decision: body.decision as "approve" | "decline" | "lead_track",
      note: String(body.note || ""),
      addendumSigned: Boolean(body.addendumSigned),
      rubric: Array.isArray(body.rubric) ? body.rubric as [] : [],
    });
    if (reviewed.ok === false) return NextResponse.json({ error: reviewed.error }, { status: 400 });
    const cleanerId = String(body.cleanerId || "");
    const status = body.decision === "approve" ? "lead" : body.decision === "lead_track" ? null : null;
    await supabase.from("cleaners").update({
      lead_status: status,
      lead_track: body.decision === "lead_track",
      updated_at: new Date().toISOString(),
    }).eq("id", cleanerId);
    await supabase.from("events").insert({
      event_type: "lead.decision",
      source: "contractor-intake",
      cleaner_id: cleanerId,
      summary: `Lead decision ${body.decision} by ${admin.email}: ${String(body.note)}`,
      data: body,
    });
    return NextResponse.json({ ok: true, message: applicantMessage("lead_decision", { body: String(body.note) }).text });
  }

  if (action === "pre_adverse") {
    const actionRecord = openPreAdverse(new Date(), settings);
    return NextResponse.json({ ok: true, adverse: actionRecord, notice: applicantMessage("pre_adverse").text });
  }

  if (action === "final_adverse") {
    const current = body.adverse as { phase: "waiting"; finalAllowedAt: string | null; finalSentAt: string | null; preAdverseSentAt: string | null };
    if (!canSendFinalAdverse(current, new Date())) {
      return NextResponse.json({ error: "The waiting period has not ended." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, notice: applicantMessage("final_adverse", { body: String(body.providerContact || "") }).text });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
