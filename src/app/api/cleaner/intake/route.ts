// Verification steps added to the existing onboarding. Agreement, W-9, payout,
// and training stay on their own screens.

import { NextResponse } from "next/server";
import { AdminAuthError, requireUser } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { acceptVehiclePhoto, identityPath } from "@/lib/contractor-intake/verification";
import { applicantDeadline, imageDeleteOn, openPreAdverse } from "@/lib/contractor-intake/onboarding";
import { INTAKE_WORDING } from "@/lib/contractor-intake/wording";
import { DEFAULT_INTAKE_SETTINGS, INTAKE_SETTINGS_KEY, mergeIntakeSettings } from "@/lib/contractor-intake/settings";
import { leadEligible, type ReliabilityRecord } from "@/lib/contractor-intake/lead";
import {
  ROLE_COPY_KEY,
  accessFromCatalog,
  buildRoleSections,
  mergeRoleCatalog,
  parseRoleInterest,
  upsertSection,
  sectionsFromUnknown,
} from "@/lib/contractor-roles";
import { CONTRACTOR_ORIGIN, onboardingHostAllowed, requestHost } from "@/lib/site-hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function wrongHost(req: Request): NextResponse | null {
  if (onboardingHostAllowed(requestHost(req))) return null;
  return NextResponse.json(
    { error: `Onboarding opens only at ${CONTRACTOR_ORIGIN}.` },
    { status: 403 },
  );
}

export async function GET(req: Request): Promise<NextResponse> {
  const blocked = wrongHost(req);
  if (blocked) return blocked;
  try {
    const user = await requireUser(req);
    const supabase = getAdminSupabase();
    const { data, error } = await supabase
      .from("cleaners")
      .select("id, intake_flow, intake_record, kit_confirmed, background_cleared, identity_image_delete_at, status, approved, created_at, novara_score, completed_bookings, lead_status")
      .eq("user_id", user.userId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "No contractor record is open." }, { status: 404 });
    const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", INTAKE_SETTINGS_KEY).maybeSingle();
    const settings = mergeIntakeSettings(settingsRow?.value && typeof settingsRow.value === "object" ? settingsRow.value : null);
    const created = data.created_at ? Date.parse(String(data.created_at)) : Date.now();
    const tenureDays = Math.floor((Date.now() - created) / 86_400_000);
    const record: ReliabilityRecord = {
      active: String(data.status || "") === "active" && data.approved !== false,
      inProbation: tenureDays < settings.leadMinTenureDays,
      tenureDays,
      completedJobs: Number(data.completed_bookings) || 0,
      novaraScore: Number(data.novara_score) || 0,
      noShows: 0,
      lateCancellations: 0,
      openComplaints: 0,
      openQcCases: 0,
      vehicleVerified: true,
      kitConfirmed: data.kit_confirmed !== false,
    };
    const invited = Boolean((data.intake_record as { leadInvited?: boolean } | null)?.leadInvited);
    return NextResponse.json({
      ok: true,
      intakeFlow: data.intake_flow,
      record: data.intake_record || {},
      kitConfirmed: data.kit_confirmed,
      backgroundCleared: data.background_cleared,
      leadCanApply: settings.leadRoleOpenToPublic || invited || leadEligible(record, settings).ok,
      deadlines: {
        onboardingBy: applicantDeadline(new Date(), DEFAULT_INTAKE_SETTINGS).toISOString(),
      },
    });
  } catch (err) {
    const error = err as AdminAuthError;
    return NextResponse.json({ error: error.message }, { status: error.status || 401 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const blocked = wrongHost(req);
  if (blocked) return blocked;
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("cleaners").select("id, first_name, intake_flow, intake_record, status, approved, created_at, novara_score, completed_bookings, kit_confirmed").eq("user_id", user.userId).maybeSingle();
    if (!data) return NextResponse.json({ error: "No contractor record is open." }, { status: 404 });
    const record = (data.intake_record && typeof data.intake_record === "object" ? data.intake_record : {}) as Record<string, unknown>;
    const action = String(body.action || "");
    const now = new Date().toISOString();

    if (action === "add_role") {
      const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", INTAKE_SETTINGS_KEY).maybeSingle();
      const settings = mergeIntakeSettings(settingsRow?.value && typeof settingsRow.value === "object" ? settingsRow.value : null);
      const { data: copyRow } = await supabase.from("app_settings").select("value").eq("key", ROLE_COPY_KEY).maybeSingle();
      const catalog = mergeRoleCatalog(copyRow?.value);
      const created = data.created_at ? Date.parse(String(data.created_at)) : Date.now();
      const tenureDays = Math.floor((Date.now() - created) / 86_400_000);
      const reliability: ReliabilityRecord = {
        active: String(data.status || "") === "active" && data.approved !== false,
        inProbation: tenureDays < settings.leadMinTenureDays,
        tenureDays,
        completedJobs: Number(data.completed_bookings) || 0,
        novaraScore: Number(data.novara_score) || 0,
        noShows: 0,
        lateCancellations: 0,
        openComplaints: 0,
        openQcCases: 0,
        vehicleVerified: true,
        kitConfirmed: data.kit_confirmed !== false,
      };
      const invited = Boolean(record.leadInvited);
      const access = accessFromCatalog(catalog, {
        leadRoleOpenToPublic: settings.leadRoleOpenToPublic,
        eligibleOrInvited: invited || leadEligible(reliability, settings).ok,
      });
      const built = buildRoleSections(parseRoleInterest(body.interests), catalog, access, now, "add_one");
      if (built.ok === false) return NextResponse.json({ error: built.error, code: built.code }, { status: 400 });
      const section = built.sections[0];
      record.roleApplications = upsertSection(sectionsFromUnknown(record.roleApplications), section);
      await supabase.from("cleaners").update({ intake_record: record, updated_at: now }).eq("id", data.id);
      await supabase.from("events").insert({
        event_type: "role.application",
        source: "contractor-intake",
        cleaner_id: data.id,
        summary: `${section.name} application from ${data.first_name || "a contractor"}`,
        data: { roleId: section.roleId },
      });
      return NextResponse.json({
        ok: true,
        message: `A person will review ${section.name}. Your Field Cleaner work is unchanged.`,
      });
    }

    if (data.intake_flow !== "automated") return NextResponse.json({ error: "No automated onboarding is open." }, { status: 404 });
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const device = req.headers.get("user-agent")?.slice(0, 500) || null;

    if (action === "identity_consent" || action === "identity_decline") {
      const consented = action === "identity_consent";
      const wording = INTAKE_WORDING.find((row) => row.id === "identity_consent");
      record.identity = identityPath(consented);
      record.identityConsent = wording && consented ? { id: wording.id, version: wording.version, status: wording.status, acceptedAt: now, ip, device } : null;
      if (consented) record.identityImageDeleteAt = imageDeleteOn(new Date(), DEFAULT_INTAKE_SETTINGS).toISOString();
      await supabase.from("cleaners").update({ intake_record: record, updated_at: now }).eq("id", data.id);
      return NextResponse.json({
        ok: true,
        message: consented ? "Face match can start." : "A person will review a secure upload instead.",
      });
    }

    if (action === "vehicle_photo") {
      const photo = acceptVehiclePhoto(String(body.source || ""), String(body.takenAt || ""));
      if (!photo.ok) return NextResponse.json({ error: photo.error }, { status: 400 });
      record.vehicle = "photo_received";
      record.vehicleTakenAt = body.takenAt;
      await supabase.from("cleaners").update({ intake_record: record, updated_at: now }).eq("id", data.id);
      return NextResponse.json({ ok: true, message: "Vehicle photo saved with its time and date." });
    }

    if (action === "kit") {
      const complete = Boolean(body.complete);
      record.kitConfirmed = complete;
      record.kitTakenAt = now;
      await supabase.from("cleaners").update({
        intake_record: record,
        kit_confirmed: complete,
        updated_at: now,
      }).eq("id", data.id);
      return NextResponse.json({
        ok: true,
        message: complete ? "Kit confirmed." : "Onboarding can continue. Jobs stay blocked until the kit is confirmed.",
      });
    }

    if (action === "lead_application") {
      record.leadApplication = {
        answers: body.answers || {},
        note: String(body.note || ""),
        submittedAt: now,
      };
      await supabase.from("cleaners").update({ intake_record: record, updated_at: now }).eq("id", data.id);
      return NextResponse.json({ ok: true, message: "A person will review this. Approval requires a note from that person and the signed addendum." });
    }

    if (action === "background_authorize") {
      const wording = INTAKE_WORDING.find((row) => row.id === "background_authorization");
      record.backgroundAuthorization = wording ? { id: wording.id, version: wording.version, status: wording.status, acceptedAt: now, ip, device } : null;
      record.background = "authorized";
      await supabase.from("cleaners").update({ intake_record: record, background_cleared: false, updated_at: now }).eq("id", data.id);
      return NextResponse.json({ ok: true, message: "Authorization recorded. A clear result continues. Anything else waits for a person.", preAdverse: openPreAdverse(new Date()).phase });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    const error = err as AdminAuthError;
    return NextResponse.json({ error: error.message }, { status: error.status || 401 });
  }
}
