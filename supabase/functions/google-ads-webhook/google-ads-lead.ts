// Google Ads lead form webhook payload.
// https://developers.google.com/google-ads/webhook
//
// Google POSTs this JSON. The key we type into Google Ads comes back as
// google_key on every request, including the "Send test data" lead.

export interface GoogleAdsLeadColumn {
  column_name?: string;
  string_value?: string;
  column_id?: string;
}

export interface GoogleAdsLeadBody {
  lead_id?: string;
  user_column_data?: GoogleAdsLeadColumn[];
  api_version?: string;
  form_id?: number | string;
  campaign_id?: number | string;
  adgroup_id?: number | string;
  creative_id?: number | string;
  gcl_id?: string;
  google_key?: string;
  is_test?: boolean;
}

export interface MappedGoogleAdsLead {
  source: "google_ads";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  zipCode: string;
  city: string;
  state: string;
  address: string;
  notes: string;
  leadScore: "hot";
  gclid: string;
  utmSource: "google";
  utmMedium: "cpc";
  utmCampaign: string;
  googleLeadId: string;
  isTest: boolean;
}

const STANDARD_COLUMNS = new Set([
  "FULL_NAME",
  "FIRST_NAME",
  "LAST_NAME",
  "EMAIL",
  "WORK_EMAIL",
  "PHONE_NUMBER",
  "WORK_PHONE",
  "POSTAL_CODE",
  "CITY",
  "REGION",
  "COUNTRY",
  "STREET_ADDRESS",
  "COMPANY_NAME",
  "JOB_TITLE",
]);

export function isGoogleAdsLeadPayload(body: unknown): body is GoogleAdsLeadBody {
  if (!body || typeof body !== "object") return false;
  const row = body as Record<string, unknown>;
  if (typeof row.google_key !== "string" || !row.google_key.trim()) return false;
  if (Array.isArray(row.user_column_data)) return true;
  if (row.is_test === true) return true;
  return typeof row.lead_id === "string" && row.lead_id.trim().length > 0;
}

export function googleAdsKeyMatches(provided: string, expected: string): boolean {
  const a = String(provided || "");
  const b = String(expected || "");
  if (!b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function columnValue(columns: GoogleAdsLeadColumn[], id: string): string {
  const want = id.toUpperCase();
  const row = columns.find((column) => String(column.column_id || "").toUpperCase() === want);
  return String(row?.string_value || "").trim();
}

function splitFullName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function mapGoogleAdsLead(body: GoogleAdsLeadBody): MappedGoogleAdsLead {
  const columns = Array.isArray(body.user_column_data) ? body.user_column_data : [];
  const named = splitFullName(columnValue(columns, "FULL_NAME"));
  const firstName = columnValue(columns, "FIRST_NAME") || named.firstName;
  const lastName = columnValue(columns, "LAST_NAME") || named.lastName;
  const email = columnValue(columns, "EMAIL") || columnValue(columns, "WORK_EMAIL");
  const phone = columnValue(columns, "PHONE_NUMBER") || columnValue(columns, "WORK_PHONE");
  const company = columnValue(columns, "COMPANY_NAME");
  const jobTitle = columnValue(columns, "JOB_TITLE");
  const extras = columns
    .filter((column) => {
      const id = String(column.column_id || "").toUpperCase();
      return !STANDARD_COLUMNS.has(id) && String(column.string_value || "").trim();
    })
    .map((column) => `${column.column_name || column.column_id || "Field"}: ${String(column.string_value).trim()}`);

  const googleLeadId = String(body.lead_id || "").trim();
  const notes = [
    googleLeadId ? `google_lead_id: ${googleLeadId}` : "",
    body.form_id != null ? `form_id: ${body.form_id}` : "",
    body.campaign_id != null ? `campaign_id: ${body.campaign_id}` : "",
    body.adgroup_id != null ? `adgroup_id: ${body.adgroup_id}` : "",
    body.creative_id != null ? `creative_id: ${body.creative_id}` : "",
    company ? `company: ${company}` : "",
    jobTitle ? `job_title: ${jobTitle}` : "",
    ...extras,
  ].filter(Boolean).join("\n");

  return {
    source: "google_ads",
    firstName,
    lastName,
    email,
    phone,
    zipCode: columnValue(columns, "POSTAL_CODE"),
    city: columnValue(columns, "CITY"),
    state: columnValue(columns, "REGION"),
    address: columnValue(columns, "STREET_ADDRESS"),
    notes,
    leadScore: "hot",
    gclid: String(body.gcl_id || "").trim(),
    utmSource: "google",
    utmMedium: "cpc",
    utmCampaign: body.campaign_id == null ? "" : String(body.campaign_id),
    googleLeadId,
    isTest: body.is_test === true,
  };
}
