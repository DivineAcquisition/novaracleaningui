import type { SupabaseClient } from "@supabase/supabase-js";
import { APPLICANT_ID_BUCKET } from "@/lib/hiring/application";
import { clearTalentGovernmentId } from "@/lib/airtable/talent";
import { mergeIntakeSettings, type IntakeSettings } from "./settings";
import { INTAKE_SETTINGS_KEY } from "./settings";
import { planIdDeletion } from "./id-retention";

export interface IdCleanupRow {
  applicantId: string;
  email: string | null;
  path: string;
  reason: string;
  airtable: "cleared" | "failed" | "none" | "skipped";
}

export async function runApplicantIdCleanup(
  supabase: SupabaseClient,
  opts: { dryRun: boolean; now?: Date },
): Promise<{ dryRun: boolean; planned: IdCleanupRow[]; deleted: IdCleanupRow[]; skipped: IdCleanupRow[] }> {
  const now = opts.now || new Date();
  const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", INTAKE_SETTINGS_KEY).maybeSingle();
  const settings = mergeIntakeSettings(settingsRow?.value && typeof settingsRow.value === "object" ? settingsRow.value as Partial<IntakeSettings> : null);
  const { data: rows } = await supabase
    .from("cleaner_applicants")
    .select("id, email, stage, government_id_path, government_id_deleted_at, airtable_record_id, created_at, updated_at, stage_changed_at")
    .not("government_id_path", "is", null)
    .limit(500);
  const { data: holds } = await supabase.from("contractor_data_requests").select("applicant_email, status").eq("status", "open").limit(500);
  const heldEmails = new Set((holds || []).map((row) => String(row.applicant_email || "").trim().toLowerCase()).filter(Boolean));
  const planned: IdCleanupRow[] = [];
  const deleted: IdCleanupRow[] = [];
  const skipped: IdCleanupRow[] = [];

  for (const row of rows || []) {
    if (row.government_id_deleted_at) continue;
    const path = String(row.government_id_path || "");
    if (!path) continue;
    const email = String(row.email || "").trim().toLowerCase();
    const stage = String(row.stage || "");
    const hasHold = stage === "hold" || (email && heldEmails.has(email));
    let approvedIdDue = false;
    if (email) {
      const { data: cleaner } = await supabase
        .from("cleaners")
        .select("identity_image_delete_at, identity_images_deleted_at")
        .ilike("email", email)
        .limit(1)
        .maybeSingle();
      const due = cleaner?.identity_image_delete_at ? Date.parse(String(cleaner.identity_image_delete_at)) : NaN;
      approvedIdDue = !cleaner?.identity_images_deleted_at && Number.isFinite(due) && due <= now.getTime();
    }
    const decidedAt = String(row.stage_changed_at || row.updated_at || "");
    const plan = planIdDeletion({
      stage,
      decidedAt: decidedAt || null,
      uploadedAt: String(row.created_at || "") || null,
      hasHold,
      identityResultAt: null,
      now,
      settings,
    });
    if (approvedIdDue && !hasHold) {
      plan.delete = true;
      plan.reason = "approved_identity";
    }
    const item: IdCleanupRow = {
      applicantId: String(row.id),
      email: row.email,
      path,
      reason: plan.reason,
      airtable: "none",
    };
    if (!plan.delete) {
      if (plan.reason === "hold") skipped.push({ ...item, reason: "hold" });
      continue;
    }
    planned.push(item);
    if (opts.dryRun) continue;
    const { error: removeError } = await supabase.storage.from(APPLICANT_ID_BUCKET).remove([path]);
    if (removeError) {
      skipped.push({ ...item, reason: `storage: ${removeError.message}` });
      continue;
    }
    let airtable: IdCleanupRow["airtable"] = "none";
    if (row.airtable_record_id && String(row.airtable_record_id).startsWith("rec")) {
      airtable = await clearTalentGovernmentId(String(row.airtable_record_id));
    }
    await supabase.from("cleaner_applicants").update({
      government_id_path: null,
      government_id_deleted_at: now.toISOString(),
      updated_at: now.toISOString(),
    }).eq("id", row.id);
    await supabase.from("events").insert({
      event_type: "applicant.id_deleted",
      source: "applicant-id-cleanup",
      summary: `Deleted application photo ID for ${email || row.id} (${plan.reason}). Airtable: ${airtable}.`,
      data: { applicant_id: row.id, path, reason: plan.reason, airtable, at: now.toISOString() },
    });
    deleted.push({ ...item, airtable });
  }
  return { dryRun: opts.dryRun, planned, deleted, skipped };
}
