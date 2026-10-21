// Public settings the application is allowed to show. No applicant data.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { INTAKE_SETTINGS_KEY, mergeIntakeSettings } from "@/lib/contractor-intake/settings";
import { INTAKE_WORDING, WORDING_STATUS_LABEL } from "@/lib/contractor-intake/wording";
import { applicationHostAllowed, HIRING_ORIGIN, requestHost } from "@/lib/site-hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  if (!applicationHostAllowed(requestHost(req))) {
    return NextResponse.json(
      { error: `Applications are accepted only at ${HIRING_ORIGIN}/hiring/apply.` },
      { status: 403 },
    );
  }
  let leadRoleOpenToPublic = false;
  let minDaysAvailable = 2;
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_settings").select("value").eq("key", INTAKE_SETTINGS_KEY).maybeSingle();
    const settings = mergeIntakeSettings(data?.value && typeof data.value === "object" ? data.value : null);
    leadRoleOpenToPublic = settings.leadRoleOpenToPublic;
    minDaysAvailable = settings.minDaysAvailable;
  } catch {
    // Defaults stay in force when settings cannot be read.
  }
  return NextResponse.json({
    leadRoleOpenToPublic,
    minDaysAvailable,
    wordingStatus: WORDING_STATUS_LABEL,
    why: Object.fromEntries(INTAKE_WORDING.filter((row) => row.id.startsWith("why_") || row.id.startsWith("application_")).map((row) => [row.id, row.body])),
  });
}
