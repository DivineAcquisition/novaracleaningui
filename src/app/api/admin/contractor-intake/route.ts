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
import { deliverCompliantEmail } from "@/lib/email-compliance/deliver";
import {
  ROLE_COPY_KEY,
  draftWording,
  editQuestionCopy,
  editRoleCopy,
  markCopyReviewed,
  mergeRoleCatalog,
  recordRoleDecision,
  rolePaySettings,
  sectionsFromUnknown,
  setRolePublic,
  type ContractorRoleId,
  type RoleCatalog,
  type RoleDecisionKind,
  type SavedRoleSection,
} from "@/lib/contractor-roles";
import { complianceDashboard, countByStage, type DashboardRow } from "@/lib/contractor-intake/verification";
import { leadEligible, reviewLeadAssignment, type ReliabilityRecord } from "@/lib/contractor-intake/lead";
import { reviewLeadApplication } from "@/lib/contractor-intake/lead-application";
import { applicantMessage } from "@/lib/contractor-intake/messages";
import { canSendFinalAdverse, openPreAdverse } from "@/lib/contractor-intake/onboarding";
import { runApplicantIdCleanup } from "@/lib/contractor-intake/run-id-cleanup";

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

async function loadRoleCatalog(supabase: ReturnType<typeof getAdminSupabase>): Promise<RoleCatalog> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", ROLE_COPY_KEY).maybeSingle();
  return mergeRoleCatalog(data?.value);
}

async function saveRoleCatalog(supabase: ReturnType<typeof getAdminSupabase>, catalog: RoleCatalog): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("app_settings").upsert({ key: ROLE_COPY_KEY, value: catalog });
  return error ? { ok: false, error: error.message } : { ok: true };
}

async function loadRoleReviews(supabase: ReturnType<typeof getAdminSupabase>): Promise<Array<{ applicantId: string | null; cleanerId: string | null; name: string; email: string | null; sections: SavedRoleSection[] }>> {
  const reviews: Array<{ applicantId: string | null; cleanerId: string | null; name: string; email: string | null; sections: SavedRoleSection[] }> = [];
  const applicants = await supabase.from("cleaner_applicants").select("id, full_name, email, submission").order("created_at", { ascending: false }).limit(150);
  for (const row of applicants.data || []) {
    const submission = row.submission && typeof row.submission === "object" ? row.submission as { roleApplications?: unknown } : {};
    const sections = sectionsFromUnknown(submission.roleApplications);
    if (sections.length) reviews.push({ applicantId: String(row.id), cleanerId: null, name: String(row.full_name || ""), email: row.email ? String(row.email) : null, sections });
  }
  const cleaners = await supabase.from("cleaners").select("id, first_name, last_name, email, intake_record").limit(200);
  for (const row of cleaners.data || []) {
    const record = row.intake_record && typeof row.intake_record === "object" ? row.intake_record as { roleApplications?: unknown } : {};
    const sections = sectionsFromUnknown(record.roleApplications);
    if (!sections.length) continue;
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ");
    const existing = reviews.find((item) => item.email && row.email && item.email.toLowerCase() === String(row.email).toLowerCase());
    if (existing) existing.cleanerId = String(row.id);
    else reviews.push({ applicantId: null, cleanerId: String(row.id), name, email: row.email ? String(row.email) : null, sections });
  }
  return reviews;
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
  const roleCatalog = await loadRoleCatalog(supabase);
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
  let applicationIdsPastDeletion = 0;
  try {
    const preview = await runApplicantIdCleanup(supabase, { dryRun: true });
    applicationIdsPastDeletion = preview.planned.length;
  } catch {
    applicationIdsPastDeletion = 0;
  }
  return NextResponse.json({
    ok: true,
    wordingStatus: WORDING_STATUS_LABEL,
    applicationIdsPastDeletion,
    settings,
    wording,
    roleCatalog,
    draftRoles: draftWording(roleCatalog),
    pay: rolePaySettings(settings),
    roleReviews: await loadRoleReviews(supabase),
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
    const next = wording.map((row) => row.id === id ? { ...row, status: "reviewed" as const, reviewedBy: admin.email, reviewedAt: new Date().toISOString() } : row);
    if (!next.some((row) => row.id === id)) return NextResponse.json({ error: "Unknown wording." }, { status: 404 });
    const { error } = await supabase.from("app_settings").upsert({ key: INTAKE_WORDING_KEY, value: next });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, wording: next });
  }

  if (action === "save_wording") {
    const wording = await loadWording(supabase);
    const id = String(body.id || "");
    const text = String(body.body || "");
    const next = wording.map((row) => {
      if (row.id !== id || row.body === text) return row;
      return { ...row, body: text, version: Number(row.version || 1) + 1, status: "draft" as const, reviewedBy: null, reviewedAt: null };
    });
    const { error } = await supabase.from("app_settings").upsert({ key: INTAKE_WORDING_KEY, value: next });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, wording: next });
  }

  if (action === "id_cleanup_preview" || action === "id_cleanup") {
    const dryRun = action !== "id_cleanup" || body.confirm !== true;
    const result = await runApplicantIdCleanup(supabase, { dryRun });
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "save_role_copy") {
    const catalog = await loadRoleCatalog(supabase);
    const id = String(body.id || "");
    const patch = (body.patch && typeof body.patch === "object" ? body.patch : {}) as Record<string, unknown>;
    const kind = String(body.kind || "");
    const next = kind === "question"
      ? editQuestionCopy(catalog, id, {
        prompt: typeof patch.prompt === "string" ? patch.prompt : undefined,
        why: typeof patch.why === "string" ? patch.why : undefined,
        helper: typeof patch.helper === "string" ? patch.helper : undefined,
        reviewerGuide: typeof patch.reviewerGuide === "string" ? patch.reviewerGuide : undefined,
        options: Array.isArray(patch.options) ? patch.options.map((item) => String(item)) : undefined,
      })
      : editRoleCopy(catalog, id as ContractorRoleId, {
        name: typeof patch.name === "string" ? patch.name : undefined,
        tag: typeof patch.tag === "string" ? patch.tag : undefined,
        shortDescription: typeof patch.shortDescription === "string" ? patch.shortDescription : undefined,
        whatYoullDo: Array.isArray(patch.whatYoullDo) ? patch.whatYoullDo.map((item) => String(item)) : undefined,
        whatYoullNeed: Array.isArray(patch.whatYoullNeed) ? patch.whatYoullNeed.map((item) => String(item)) : undefined,
      });
    if (kind === "question" && !next.questions.some((row) => row.id === id)) {
      return NextResponse.json({ error: "Unknown question." }, { status: 404 });
    }
    if (kind !== "question" && !next.roles.some((row) => row.id === id)) {
      return NextResponse.json({ error: "Unknown role." }, { status: 404 });
    }
    const saved = await saveRoleCatalog(supabase, next);
    if (saved.ok === false) return NextResponse.json({ error: saved.error }, { status: 500 });
    return NextResponse.json({ ok: true, roleCatalog: next, draftRoles: draftWording(next) });
  }

  if (action === "mark_role_reviewed") {
    const catalog = await loadRoleCatalog(supabase);
    const id = String(body.id || "");
    const next = markCopyReviewed(catalog, id);
    const saved = await saveRoleCatalog(supabase, next);
    if (saved.ok === false) return NextResponse.json({ error: saved.error }, { status: 500 });
    return NextResponse.json({ ok: true, roleCatalog: next, draftRoles: draftWording(next) });
  }

  if (action === "set_role_public") {
    const catalog = await loadRoleCatalog(supabase);
    const id = String(body.id || "") as ContractorRoleId;
    if (!catalog.roles.some((row) => row.id === id)) return NextResponse.json({ error: "Unknown role." }, { status: 404 });
    const next = setRolePublic(catalog, id, Boolean(body.publicEnabled));
    const saved = await saveRoleCatalog(supabase, next);
    if (saved.ok === false) return NextResponse.json({ error: saved.error }, { status: 500 });
    return NextResponse.json({ ok: true, roleCatalog: next });
  }

  if (action === "role_decision") {
    const reviews = await loadRoleReviews(supabase);
    const applicantId = String(body.applicantId || "");
    const cleanerId = String(body.cleanerId || "");
    const target = reviews.find((row) => (applicantId && row.applicantId === applicantId) || (cleanerId && row.cleanerId === cleanerId));
    if (!target) return NextResponse.json({ error: "That application is not in the review queue." }, { status: 404 });
    const reviewed = recordRoleDecision(target.sections, {
      roleId: String(body.roleId || "") as ContractorRoleId,
      decision: String(body.decision || "") as RoleDecisionKind,
      note: String(body.note || ""),
      reviewer: admin.email,
      at: new Date().toISOString(),
      firstName: String(body.firstName || target.name || ""),
    });
    if (reviewed.ok === false) return NextResponse.json({ error: reviewed.error }, { status: 400 });
    if (target.applicantId) {
      const { data: existing } = await supabase.from("cleaner_applicants").select("submission").eq("id", target.applicantId).maybeSingle();
      const submission = existing?.submission && typeof existing.submission === "object" ? existing.submission as Record<string, unknown> : {};
      await supabase.from("cleaner_applicants").update({
        submission: { ...submission, roleApplications: reviewed.sections },
      }).eq("id", target.applicantId);
    }
    if (target.cleanerId) {
      const { data: existing } = await supabase.from("cleaners").select("intake_record").eq("id", target.cleanerId).maybeSingle();
      const record = existing?.intake_record && typeof existing.intake_record === "object" ? existing.intake_record as Record<string, unknown> : {};
      await supabase.from("cleaners").update({
        intake_record: { ...record, roleApplications: reviewed.sections },
        updated_at: new Date().toISOString(),
      }).eq("id", target.cleanerId);
    }
    await supabase.from("events").insert({
      event_type: "role.decision",
      source: "contractor-intake",
      cleaner_id: target.cleanerId || null,
      summary: `${body.roleId} ${body.decision} by ${admin.email}`,
      data: { applicantId: target.applicantId, cleanerId: target.cleanerId, roleId: body.roleId, decision: body.decision, nextStep: reviewed.nextStep },
    });
    if (target.email) {
      const { data: secret } = await supabase.from("app_secrets").select("value").eq("key", "RESEND_API_KEY").maybeSingle();
      if (secret?.value) {
        await deliverCompliantEmail(supabase, {
          to: target.email,
          subject: reviewed.message.subject,
          html: `<p>${reviewed.message.text.replace(/\n/g, "<br>")}</p>`,
          apiKey: String(secret.value),
          declaredType: "contractor_operational",
          templateKey: "contractor_reject",
        }).catch(() => undefined);
      }
    }
    return NextResponse.json({ ok: true, sections: reviewed.sections, message: reviewed.message.text, nextStep: reviewed.nextStep });
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
