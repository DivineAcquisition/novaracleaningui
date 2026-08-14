// Paid channels that already exist on pl_ad_spend (CHECK constraint) and
// the P&L "Ad Spend" sheet dropdown. Instagram is kept because the sheet
// already lists it; Other is optional for anything that isn't one of these.

export const PAID_PLATFORMS = ["Facebook", "LSA", "Google", "Instagram"] as const;
export const ALL_PLATFORMS = [...PAID_PLATFORMS, "Other"] as const;

export type PaidPlatform = (typeof ALL_PLATFORMS)[number];

export const PLATFORM_HELP: Record<PaidPlatform, string> = {
  Facebook: "Meta / Facebook ads",
  LSA: "Google Local Services Ads",
  Google: "Google Ads (Search / Performance Max, not LSA)",
  Instagram: "Instagram / Meta if you track it separately from Facebook",
  Other: "Any other paid channel (Yelp, Nextdoor, etc.)",
};

export type ChannelEntry = {
  platform: PaidPlatform;
  spend_dollars: string;
  leads_calls: string;
  booked_jobs: string;
  campaign_notes: string;
};

export function emptyEntry(platform: PaidPlatform): ChannelEntry {
  return { platform, spend_dollars: "", leads_calls: "", booked_jobs: "", campaign_notes: "" };
}
