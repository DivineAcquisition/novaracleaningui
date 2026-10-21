// Verification steps added to the existing onboarding. Agreement, W-9, payout,
// and training stay on their own screens.

import { NextResponse } from "next/server";
import { AdminAuthError, requireUser } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { acceptVehiclePhoto, identityPath } from "@/lib/contractor-intake/verification";
import { applicantDeadline, imageDeleteOn, openPreAdverse } from "@/lib/contractor-intake/onboarding";
import { INTAKE_WORDING } from "@/lib/contractor-intake/wording";
import { DEFAULT_INTAKE_SETTINGS } from "@/lib/contractor-intake/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const user = await requireUser(req);
    const supabase = getAdminSupabase();
    const { data, error } = await supabase
      .from("cleaners")
      .select("id, intake_flow, intake_record, kit_confirmed, background_cleared, identity_image_delete_at")
      .eq("user_id", user.userId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.intake_flow !== "automated") return NextResponse.json({ error: "No automated onboarding is open." }, { status: 404 });
    return NextResponse.json({
      ok: true,
      intakeFlow: data.intake_flow,
      record: data.intake_record || {},
      kitConfirmed: data.kit_confirmed,
      backgroundCleared: data.background_cleared,
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
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("cleaners").select("id, intake_flow, intake_record").eq("user_id", user.userId).maybeSingle();
    if (!data || data.intake_flow !== "automated") return NextResponse.json({ error: "No automated onboarding is open." }, { status: 404 });
    const record = (data.intake_record && typeof data.intake_record === "object" ? data.intake_record : {}) as Record<string, unknown>;
    const action = String(body.action || "");
    const now = new Date().toISOString();
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
