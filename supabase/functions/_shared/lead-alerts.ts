// ─── Facebook / paid-social lead staff alerts ─────────────────────────────
//
// Team Discord for new leads rides public.events → discord_routes
// (lead.facebook.created). This helper is the extra fan-out that the DB
// trigger cannot do:
//   • email every admin + VA
//   • ping the assigned VA's private Discord webhook, when they have one
//
// Pure parsers (source detection, Meta Lead Ads field mapping) live here
// so they can be unit-tested without Deno.

import { resolveSecret } from "./app-secrets.ts";

// deno-lint-ignore no-explicit-any
type DB = any;

export interface LeadAlertInput {
  leadId: string;
  source: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  zipCode?: string | null;
  city?: string | null;
  state?: string | null;
  serviceType?: string | null;
  leadScore?: string | null;
  assignedVaUserId?: string | null;
  assignedVaName?: string | null;
  fbLeadId?: string | null;
  notes?: string | null;
}

export interface LeadAlertResult {
  emailed: boolean;
  emailRecipients: number;
  vaDiscord: boolean;
}

const FACEBOOK_SOURCE_RE =
  /(fb_lead|facebook|^fb$|fb[-_ ]?ads|meta|instagram|ig_lead)/i;

const FROM_ADDRESS = "Novara Cleaning <hello@novaracleaning.com>";
const ADMIN_CSR_URL = "https://admin.novaracleaning.com/admin/csr";
const FACEBOOK_BLUE = 1752220;

export function isFacebookLeadSource(source?: string | null): boolean {
  const v = String(source || "").trim();
  if (!v) return false;
  return FACEBOOK_SOURCE_RE.test(v);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function splitFullName(full?: string | null): { firstName: string; lastName: string } {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export interface MetaField {
  name?: string;
  values?: string[];
}

/** Flatten Meta Lead Ads field_data into the lead-intake payload shape. */
export function mapMetaLeadFields(
  fieldData: MetaField[] | null | undefined,
): {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  zipCode?: string;
  city?: string;
  state?: string;
  address?: string;
  serviceType?: string;
  notes?: string;
} {
  const bag: Record<string, string> = {};
  for (const field of fieldData || []) {
    const key = String(field?.name || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const value = Array.isArray(field?.values) ? String(field.values[0] || "").trim() : "";
    if (!key || !value) continue;
    bag[key] = value;
  }

  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      if (bag[k]) return bag[k];
    }
    return "";
  };

  const email = pick("email", "email_address", "work_email");
  const phone = pick("phone", "phone_number", "mobile_phone", "mobile", "cell_phone");
  const zipCode = pick("zip", "zip_code", "zipcode", "postal_code", "post_code");
  const city = pick("city");
  const state = pick("state", "region");
  const address = pick("street_address", "address", "address_line_1");
  const serviceType = pick(
    "service",
    "service_type",
    "which_service_are_you_interested_in",
    "what_service_are_you_interested_in",
  );

  let firstName = pick("first_name", "firstname");
  let lastName = pick("last_name", "lastname");
  if (!firstName && !lastName) {
    const split = splitFullName(pick("full_name", "name"));
    firstName = split.firstName;
    lastName = split.lastName;
  }

  const known = new Set([
    "email", "email_address", "work_email",
    "phone", "phone_number", "mobile_phone", "mobile", "cell_phone",
    "zip", "zip_code", "zipcode", "postal_code", "post_code",
    "city", "state", "region",
    "street_address", "address", "address_line_1",
    "first_name", "firstname", "last_name", "lastname", "full_name", "name",
    "service", "service_type",
    "which_service_are_you_interested_in", "what_service_are_you_interested_in",
  ]);
  const extras = Object.entries(bag)
    .filter(([k]) => !known.has(k))
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`);

  return {
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    email: email || undefined,
    phone: phone || undefined,
    zipCode: zipCode || undefined,
    city: city || undefined,
    state: state || undefined,
    address: address || undefined,
    serviceType: serviceType || undefined,
    notes: extras.length ? extras.join("\n") : undefined,
  };
}

export function extractMetaLeadgenIds(body: unknown): string[] {
  const root = body as {
    object?: string;
    entry?: Array<{
      changes?: Array<{ field?: string; value?: { leadgen_id?: string } }>;
    }>;
  };
  if (!root || typeof root !== "object") return [];
  const ids: string[] = [];
  for (const entry of root.entry || []) {
    for (const change of entry.changes || []) {
      if (change?.field && change.field !== "leadgen") continue;
      const id = String(change?.value?.leadgen_id || "").trim();
      if (id) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

export function isMetaLeadWebhook(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const root = body as { object?: unknown; entry?: unknown };
  return root.object === "page" && Array.isArray(root.entry);
}

export function leadDisplayName(lead: LeadAlertInput): string {
  const name = `${lead.firstName || ""} ${lead.lastName || ""}`.trim();
  return name || lead.email || lead.phone || "New lead";
}

export function renderFacebookLeadEmail(lead: LeadAlertInput): { subject: string; html: string } {
  const name = leadDisplayName(lead);
  const lastInitial = lead.lastName ? `${lead.lastName.charAt(0)}.` : "";
  const subjectName = lead.firstName
    ? `${lead.firstName} ${lastInitial}`.trim()
    : name;
  const zip = lead.zipCode || "ZIP n/a";
  const subject = `New Facebook lead: ${subjectName} — ${zip}`;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px;border-bottom:1px solid #E5E7EB;font-weight:600;width:160px;color:#334155">${escapeHtml(label)}</td><td style="padding:8px;border-bottom:1px solid #E5E7EB;color:#0F172A">${value}</td></tr>`;

  const phone = (lead.phone || "").trim();
  const email = (lead.email || "").trim();
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#FAFAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1877F2 0%,#5C0FFE 100%);padding:20px 24px;">
        <p style="margin:0;color:#fff;font-size:16px;font-weight:700;">New Facebook lead</p>
        <p style="margin:6px 0 0;color:#E0E7FF;font-size:13px;">Call within 2 minutes — speed-to-lead.</p>
      </div>
      <div style="padding:8px 16px 20px;">
        <table style="width:100%;border-collapse:collapse;margin-top:8px;">
          ${row("Name", escapeHtml(name))}
          ${row("Phone", phone ? `<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>` : "—")}
          ${row("Email", email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : "—")}
          ${row("ZIP", escapeHtml(lead.zipCode || "—"))}
          ${row("City / State", escapeHtml([lead.city, lead.state].filter(Boolean).join(", ") || "—"))}
          ${row("Service", escapeHtml(lead.serviceType || "—"))}
          ${row("Score", escapeHtml(lead.leadScore || "hot"))}
          ${row("Assigned VA", escapeHtml(lead.assignedVaName || "Unassigned (no VA on shift)"))}
          ${row("Source", escapeHtml(lead.source || "fb_lead_ads"))}
          ${row("Captured", escapeHtml(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })) + " ET")}
        </table>
        <p style="margin:20px 8px 0;">
          <a href="${ADMIN_CSR_URL}" style="display:inline-block;background:#5C0FFE;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px;">Open Internal Booking</a>
        </p>
      </div>
    </div>
  </body>
</html>`;
  return { subject, html };
}

export function facebookLeadDiscordDescription(lead: LeadAlertInput): string {
  const name = leadDisplayName(lead);
  const bits = [
    `**${name}** just submitted a Facebook lead form.`,
    lead.assignedVaName
      ? `Assigned to **${lead.assignedVaName}** — call in the next 2 minutes.`
      : "No VA on shift — first available VA should claim this.",
  ];
  return bits.join(" ");
}

async function staffEmails(supabase: DB, extraAssignedEmail?: string | null): Promise<string[]> {
  const emails = new Set<string>();
  const add = (raw: string) => {
    const t = raw.trim().toLowerCase();
    if (t.includes("@")) emails.add(t);
  };

  if (extraAssignedEmail) add(extraAssignedEmail);

  try {
    const extra = await resolveSecret(supabase, "LEAD_ALERT_EMAILS");
    for (const part of extra.split(/[,;]/)) add(part);
  } catch {
    /* ignore */
  }

  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["admin", "va"]);

  for (const row of roles || []) {
    try {
      const { data: userData, error } = await supabase.auth.admin.getUserById(row.user_id);
      if (!error && userData?.user?.email) add(userData.user.email);
    } catch {
      /* skip */
    }
  }

  if (emails.size === 0) add("contact@novaracleaning.com");
  return [...emails];
}

async function sendStaffEmail(
  apiKey: string,
  to: string[],
  subject: string,
  html: string,
): Promise<boolean> {
  if (!apiKey || !to.length) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
    });
    if (!res.ok) {
      console.warn("[lead-alerts] Resend failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[lead-alerts] Resend error", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function postVaDiscord(webhook: string, lead: LeadAlertInput): Promise<boolean> {
  if (!webhook.startsWith("https://discord.com/api/webhooks/")) return false;
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Novara Leads",
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title: "📣 New Facebook lead assigned to you",
            description: facebookLeadDiscordDescription(lead),
            color: FACEBOOK_BLUE,
            fields: [
              { name: "Name", value: leadDisplayName(lead), inline: true },
              { name: "Phone", value: lead.phone || "—", inline: true },
              { name: "ZIP", value: lead.zipCode || "—", inline: true },
              { name: "Email", value: lead.email || "—", inline: true },
            ].slice(0, 25),
            footer: { text: "Call within 2 minutes" },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Email admins + VAs, and ping the assigned VA's private Discord webhook.
 * Team-channel Discord is the events → discord_routes bus
 * (`lead.facebook.created`). Never throws.
 */
export async function notifyFacebookLeadStaff(
  supabase: DB,
  lead: LeadAlertInput,
): Promise<LeadAlertResult> {
  const result: LeadAlertResult = { emailed: false, emailRecipients: 0, vaDiscord: false };
  try {
    let assignedEmail: string | null = null;
    let vaWebhook: string | null = null;

    if (lead.assignedVaUserId) {
      try {
        const { data: userData } = await supabase.auth.admin.getUserById(lead.assignedVaUserId);
        assignedEmail = userData?.user?.email || null;
      } catch {
        /* ignore */
      }
      try {
        const { data: onboarding } = await supabase
          .from("va_onboarding")
          .select("email, discord_webhook_url")
          .eq("portal_user_id", lead.assignedVaUserId)
          .maybeSingle();
        if (onboarding?.email) assignedEmail = assignedEmail || onboarding.email;
        if (onboarding?.discord_webhook_url) vaWebhook = String(onboarding.discord_webhook_url).trim();
      } catch {
        /* ignore */
      }
    }

    const apiKey = await resolveSecret(supabase, "RESEND_API_KEY");
    const recipients = await staffEmails(supabase, assignedEmail);
    const { subject, html } = renderFacebookLeadEmail(lead);
    result.emailRecipients = recipients.length;
    result.emailed = await sendStaffEmail(apiKey, recipients, subject, html);

    if (vaWebhook) {
      result.vaDiscord = await postVaDiscord(vaWebhook, lead);
    }
  } catch (err) {
    console.warn(
      "[lead-alerts] staff notify failed",
      err instanceof Error ? err.message : String(err),
    );
  }
  return result;
}

export interface GraphLead {
  id?: string;
  created_time?: string;
  field_data?: MetaField[];
  ad_id?: string;
  form_id?: string;
}

export async function fetchMetaLeadById(
  supabase: DB,
  leadgenId: string,
): Promise<GraphLead | null> {
  const token = await resolveSecret(supabase, "FACEBOOK_PAGE_ACCESS_TOKEN");
  if (!token) {
    console.warn("[lead-alerts] FACEBOOK_PAGE_ACCESS_TOKEN missing — cannot fetch leadgen", leadgenId);
    return null;
  }
  const version = (await resolveSecret(supabase, "FACEBOOK_GRAPH_API_VERSION")) || "v21.0";
  const url =
    `https://graph.facebook.com/${version}/${encodeURIComponent(leadgenId)}` +
    `?fields=id,created_time,field_data,ad_id,form_id&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn("[lead-alerts] Graph lead fetch failed", leadgenId, res.status, await res.text());
    return null;
  }
  return (await res.json()) as GraphLead;
}

export async function verifyMetaSignature(
  supabase: DB,
  rawBody: string,
  header: string | null,
): Promise<boolean> {
  const secret = await resolveSecret(supabase, "FACEBOOK_APP_SECRET");
  if (!secret) return true;
  const provided = (header || "").replace(/^sha256=/i, "").trim().toLowerCase();
  if (!provided) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}
