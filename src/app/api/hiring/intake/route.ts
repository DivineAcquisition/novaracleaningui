// Public settings the application is allowed to show. No applicant data.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { DEFAULT_INTAKE_SETTINGS, INTAKE_SETTINGS_KEY, mergeIntakeSettings, type IntakeSettings } from "@/lib/contractor-intake/settings";
import { INTAKE_WORDING } from "@/lib/contractor-intake/wording";
import {
  ROLE_COPY_KEY,
  accessFromCatalog,
  mergeRoleCatalog,
  publicRoleCards,
  rolePaySettings,
  type RoleCatalog,
} from "@/lib/contractor-roles";
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
  let settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS;
  let catalog = mergeRoleCatalog(null);
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_settings").select("value").eq("key", INTAKE_SETTINGS_KEY).maybeSingle();
    settings = mergeIntakeSettings(data?.value && typeof data.value === "object" ? data.value : null);
    const copy = await supabase.from("app_settings").select("value").eq("key", ROLE_COPY_KEY).maybeSingle();
    catalog = mergeRoleCatalog(copy.data?.value);
  } catch {
    // Defaults stay in force when settings cannot be read.
  }
  const pay = rolePaySettings(settings);
  const access = accessFromCatalog(catalog, { leadRoleOpenToPublic: settings.leadRoleOpenToPublic, eligibleOrInvited: false });
  access.recurringPublic = access.recurringPublic && Boolean((settings.recurringHomeCleanerPayLabel || "").trim());
  access.turnoverPublic = access.turnoverPublic && Boolean((settings.turnoverCleanerPayLabel || "").trim());
  access.fieldPublic = access.fieldPublic && Boolean(settings.fieldCleanerPayLabel.trim());
  const publicCopy: RoleCatalog = {
    roles: catalog.roles,
    questions: catalog.questions.map((row) => ({ ...row, reviewerGuide: "" })),
  };
  return NextResponse.json({
    leadRoleOpenToPublic: settings.leadRoleOpenToPublic,
    minDaysAvailable: settings.minDaysAvailable,
    settings,
    why: Object.fromEntries(INTAKE_WORDING.filter((row) => row.id.startsWith("why_") || row.id.startsWith("application_")).map((row) => [row.id, row.body])),
    catalog: publicCopy,
    pay,
    cards: publicRoleCards(catalog, pay, access),
  });
}
