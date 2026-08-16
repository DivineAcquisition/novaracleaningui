// Labels + notice-template defaults for pest (light) / mold (minor) findings.
// Server pricing, QC, and send live in supabase/functions/_shared/site-finding.ts.

export const SITE_FINDING_TEMPLATES_KEY = "site_finding_notice_templates";

export type SiteFindingType = "pest_light" | "mold_minor";

export const SITE_FINDING_LABELS: Record<
  SiteFindingType,
  { short: string; email: string; sms: string }
> = {
  pest_light: {
    short: "Pest — Light",
    email: "light pest presence",
    sms: "light pest presence",
  },
  mold_minor: {
    short: "Mold — Minor",
    email: "a small area of surface mold",
    sms: "minor surface mold",
  },
};

export const DEFAULT_SITE_FINDING_TEMPLATES = {
  email_subject: "A quick update on today's clean",
  email_body_priced:
    "Hi {name}, during today's visit our team found {finding} in {location} and handled it as part of the clean. This reflects a {adjustment} adjustment to today's total, bringing it to {new_total}. Before and after photos are on file.{recurrence} Thanks!",
  email_body_info:
    "Hi {name}, during today's visit our team found {finding} in {location} and handled it as part of the clean. Today's total is unchanged. Before and after photos are on file.{recurrence} Thanks!",
  sms_priced:
    "Hi {name}, quick note — we found {finding_sms} in {location} during today's clean and handled it. This added {delta} to today's total ({new_total} final). Photos on file. Thanks!",
  sms_info:
    "Hi {name}, quick note — we found {finding_sms} in {location} during today's clean and handled it. No change to today's total. Photos on file. Thanks!",
  mold_recurrence_sentence:
    " If you notice this returning in the same spot, it can sometimes point to a moisture issue worth having looked at.",
};

export type SiteFindingPricingPath = "focused_addon" | "heavy_condition" | "none";
export type SiteFindingStatus = "pending_after" | "priced" | "notified";

export interface SiteFindingDetails {
  finding_type?: SiteFindingType;
  location?: string;
  area_id?: string | null;
  confined?: boolean;
  size_confirmation?: Record<string, boolean | string>;
  pricing_path?: SiteFindingPricingPath;
  pricing_rule_label?: string;
  preview_delta_cents?: number;
  price_delta_cents?: number | null;
  original_total_cents?: number;
  new_total_cents?: number | null;
  before_photo_urls?: string[];
  after_photo_urls?: string[];
  recurrence?: boolean;
  recurrence_same_spot?: boolean;
  prior_issue_ids?: string[];
  status?: SiteFindingStatus;
  priced_at?: string | null;
  notified_at?: string | null;
  charge_status?: string | null;
  addon_charge_id?: string | null;
}
