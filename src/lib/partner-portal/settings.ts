export interface PartnerPortalSettings {
  sessionDays: number;
  magicLinkMinutes: number;
  handoffMinutes: number;
}

export const DEFAULT_PORTAL_SETTINGS: PartnerPortalSettings = {
  sessionDays: 30,
  magicLinkMinutes: 60,
  handoffMinutes: 30,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadPortalSettings(supabase: any): Promise<PartnerPortalSettings> {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "partner_portal_settings")
      .maybeSingle();
    const v = (data?.value || {}) as Record<string, unknown>;
    const days = Number(v.session_days ?? v.sessionDays);
    const magic = Number(v.magic_link_minutes ?? v.magicLinkMinutes);
    const handoff = Number(v.handoff_minutes ?? v.handoffMinutes);
    return {
      sessionDays: Number.isFinite(days) && days > 0 ? days : DEFAULT_PORTAL_SETTINGS.sessionDays,
      magicLinkMinutes:
        Number.isFinite(magic) && magic > 0 ? magic : DEFAULT_PORTAL_SETTINGS.magicLinkMinutes,
      handoffMinutes:
        Number.isFinite(handoff) && handoff > 0 ? handoff : DEFAULT_PORTAL_SETTINGS.handoffMinutes,
    };
  } catch {
    return { ...DEFAULT_PORTAL_SETTINGS };
  }
}
