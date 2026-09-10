// ─── Admin side of the property-manager onboarding session ─────────────────
//
// Sending onboarding is what mints the one tokenized link. The gate is the
// registry: every unit must already carry Company-set standing rates, because
// Page 2 asks the manager to confirm finished numbers. A registry with an
// unpriced unit is not ready to send.

import { sendPartnershipMessage } from "@/lib/partnership-comms/server";
import {
  PM_SERVICE_LABELS,
  PM_SERVICE_TYPES,
  formatRate,
  resolveVolumeDiscount,
  unitDisplayName,
} from "../pricing";
import { loadVolumeDiscounts } from "../pricing-server";
import { UNIT_COLS, countRegisteredUnits, repricePortfolio } from "../registry";
import { onboardingUrl, type SnapshotUnit } from "./session";

// eslint-disable-next-line
type Admin = any;
type Row = Record<string, unknown>;

export interface StartPmOnboardingInput {
  pmAccountId: string;
  actorName: string;
  recipientName?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  send?: boolean;
}

export interface StartPmOnboardingResult {
  ok: boolean;
  status: number;
  message?: string;
  sessionId?: string;
  token?: string;
  link?: string;
  emailed?: boolean;
  texted?: boolean;
  unitCount?: number;
  unpriced?: string[];
}

function snapshotFromUnits(rows: Row[]): SnapshotUnit[] {
  return rows
    .map((u) => {
      const rates = {} as SnapshotUnit["rates"];
      for (const service of PM_SERVICE_TYPES) {
        rates[service] = Math.round(Number(u[`standing_${service}_cents`]) || 0);
      }
      return {
        unit_id: String(u.id),
        unit_label: (u.unit_label as string) || null,
        address: (u.address as string) || null,
        city: (u.city as string) || null,
        state: (u.state as string) || null,
        zip_code: (u.zip_code as string) || null,
        sqft: u.sqft == null ? null : Number(u.sqft),
        bedrooms: u.bedrooms == null ? null : Number(u.bedrooms),
        bathrooms: u.bathrooms == null ? null : Number(u.bathrooms),
        zone_code: (u.zone_code as string) || null,
        rates,
        discount_percent: Number(u.discount_percent_applied || 0),
        special_notes: (u.special_notes as string) || null,
      } satisfies SnapshotUnit;
    })
    .filter((u) => PM_SERVICE_TYPES.every((s) => u.rates[s] > 0));
}

export async function mintPmToken(supabase: Admin): Promise<string> {
  const { data } = await supabase.rpc("mint_pm_token");
  if (data && String(data).length >= 24) return String(data);
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function settingInt(supabase: Admin, key: string, fallback: number): Promise<number> {
  const { data } = await supabase.rpc("pm_setting_int", { p_key: key, p_default: fallback });
  const n = Number(data);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function startPmOnboardingSession(
  supabase: Admin,
  input: StartPmOnboardingInput,
): Promise<StartPmOnboardingResult> {
  const { data: account } = await supabase
    .from("property_manager_accounts")
    .select("*")
    .eq("id", input.pmAccountId)
    .maybeSingle();
  if (!account) return { ok: false, status: 404, message: "Property manager account not found." };

  // Re-tier before freezing the snapshot: the rates the manager signs must be
  // the rates their portfolio size actually earns them.
  await repricePortfolio(supabase, input.pmAccountId, { actorName: input.actorName });

  const { data: units } = await supabase
    .from("property_manager_units")
    .select(UNIT_COLS)
    .eq("pm_account_id", input.pmAccountId)
    .neq("status", "inactive")
    .order("created_at", { ascending: true });

  const unitRows = (units || []) as Row[];
  if (unitRows.length === 0) {
    return { ok: false, status: 409, message: "Register at least one unit before sending onboarding." };
  }

  const unpriced = unitRows
    .filter((u) => PM_SERVICE_TYPES.some((s) => !(Number(u[`standing_${s}_cents`]) > 0)))
    .map((u) => unitDisplayName(u as { unit_label?: string | null; address?: string | null }));
  if (unpriced.length > 0) {
    return {
      ok: false,
      status: 409,
      unpriced,
      message: `Price every unit before sending: ${unpriced.slice(0, 5).join(", ")}${
        unpriced.length > 5 ? `, +${unpriced.length - 5} more` : ""
      }.`,
    };
  }

  const snapshot = snapshotFromUnits(unitRows);
  if (snapshot.length === 0) {
    return { ok: false, status: 409, message: "Price every unit before sending onboarding." };
  }

  const recipientEmail = input.recipientEmail || (account.email as string) || null;
  const recipientName = input.recipientName || (account.contact_name as string) || null;
  const recipientPhone = input.recipientPhone || (account.phone as string) || null;
  if (!recipientEmail) {
    return { ok: false, status: 400, message: "No email to send the onboarding link to." };
  }

  // One active session per account: an older link stops working the moment a
  // new one is sent, so nobody signs a stale rate schedule.
  await supabase
    .from("property_manager_onboarding_sessions")
    .update({ status: "superseded", token: null, updated_at: new Date().toISOString() })
    .eq("pm_account_id", input.pmAccountId)
    .eq("status", "active");

  const token = await mintPmToken(supabase);
  const ttlDays = await settingInt(supabase, "session_ttl_days", 30);

  const { data: session, error } = await supabase
    .from("property_manager_onboarding_sessions")
    .insert({
      pm_account_id: input.pmAccountId,
      unit_snapshot: snapshot,
      token,
      expires_at: new Date(Date.now() + ttlDays * 86400_000).toISOString(),
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      recipient_phone: recipientPhone,
      billing_method: String(account.billing_method || "invoiced"),
      created_by_name: input.actorName,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: 400, message: error.message };

  const link = onboardingUrl(token);
  const result: StartPmOnboardingResult = {
    ok: true,
    status: 200,
    sessionId: String(session.id),
    token,
    link,
    unitCount: snapshot.length,
  };

  if (input.send !== false) {
    const discount = resolveVolumeDiscount(
      await loadVolumeDiscounts(supabase),
      await countRegisteredUnits(supabase, input.pmAccountId),
    );
    const sent = await sendPmOnboardingLink(supabase, {
      sessionId: String(session.id),
      pmAccountId: input.pmAccountId,
      companyName: String(account.company_name || recipientName || "your portfolio"),
      recipientName,
      recipientEmail,
      recipientPhone,
      link,
      unitCount: snapshot.length,
      discountPercent: discount.percent,
      rateSummary: rateSummaryHtml(snapshot, discount.percent),
    });
    result.emailed = sent.emailed;
    result.texted = sent.texted;
  }

  await supabase.from("events").insert({
    event_type: "property_manager.onboarding.started",
    source: "partner-admin",
    summary: `Property manager onboarding link sent to ${recipientEmail} by ${input.actorName} (${snapshot.length} units).`,
    data: { pm_account_id: input.pmAccountId, session_id: session.id, unit_count: snapshot.length },
  });

  return result;
}

function escapeHtml(value: string): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A short preview of the schedule, so the email is worth opening. */
export function rateSummaryHtml(snapshot: SnapshotUnit[], discountPercent: number): string {
  const shown = snapshot.slice(0, 4);
  const rows = shown
    .map(
      (u) =>
        `<tr><td style="padding:4px 12px 4px 0;">${escapeHtml(
          u.unit_label || u.address || "Unit",
        )}</td><td style="padding:4px 0;">${escapeHtml(
          PM_SERVICE_TYPES.map((s) => `${PM_SERVICE_LABELS[s]} ${formatRate(u.rates[s])}`).join(" · "),
        )}</td></tr>`,
    )
    .join("");
  const more =
    snapshot.length > shown.length
      ? `<p style="margin:6px 0 0;font-size:13px;">+ ${snapshot.length - shown.length} more unit${
          snapshot.length - shown.length === 1 ? "" : "s"
        } in your registry.</p>`
      : "";
  const discountLine =
    discountPercent > 0
      ? `<p style="margin:6px 0 0;font-size:13px;"><strong>Your ${discountPercent}% portfolio discount is already in these rates.</strong></p>`
      : "";
  return `<div style="background:#EDE9FE;border-radius:8px;padding:12px 14px;"><strong>Your standing rates:</strong><table style="font-size:13px;margin-top:6px;">${rows}</table>${more}${discountLine}</div>`;
}

export async function sendPmOnboardingLink(
  supabase: Admin,
  input: {
    sessionId: string;
    pmAccountId?: string | null;
    companyName: string;
    recipientName: string | null;
    recipientEmail: string;
    recipientPhone: string | null;
    link: string;
    unitCount?: number;
    discountPercent?: number;
    rateSummary?: string;
    reminder?: boolean;
  },
): Promise<{ emailed: boolean; texted: boolean }> {
  const name = (input.recipientName || "there").split(" ")[0];
  const units = input.unitCount ?? 0;
  const sent = await sendPartnershipMessage(supabase, {
    templateKey: "property_manager_onboarding_link",
    trigger: input.reminder ? "property-manager-onboarding.reminder" : "property-manager-onboarding.send",
    email: input.recipientEmail,
    phone: input.recipientPhone,
    vars: {
      first_name: name,
      company_name: input.companyName,
      unit_count: String(units),
      link: input.link,
      rate_summary_html: input.rateSummary || "",
    },
    html: input.reminder
      ? [
          `<p>Hi ${escapeHtml(name)},</p>`,
          `<p>Just a nudge — your setup for <strong>${escapeHtml(input.companyName)}</strong> is part-finished and picks up exactly where you left off.</p>`,
          input.rateSummary || "",
          `<p><a href="${input.link}">Open your setup page</a></p>`,
        ].join("")
      : [
          `<p>Hi ${escapeHtml(name)},</p>`,
          `<p>Your unit registry for <strong>${escapeHtml(input.companyName)}</strong> is ready to review${
            units ? ` — ${units} unit${units === 1 ? "" : "s"}` : ""
          }.</p>`,
          input.rateSummary || "",
          `<p>Each unit has a standing rate we set once. From then on you book a turnover by picking the unit, the service, and the date it has to be ready by. No walkthrough, no quote, no re-pricing every time a tenant moves out.</p>`,
          `<p><a href="${input.link}">Review and confirm your registry</a></p>`,
          `<p>It's one page at a time and you can stop and come back — the same link returns you to where you left off.</p>`,
        ].join(""),
    sms: input.reminder
      ? `Novara Cleaning: your property management setup is part-finished — pick up where you left off: ${input.link}`
      : `Novara Cleaning: your unit registry and standing rates are ready to review: ${input.link}`,
  });

  const { data } = await supabase
    .from("property_manager_onboarding_sessions")
    .select("send_count")
    .eq("id", input.sessionId)
    .maybeSingle();

  await supabase
    .from("property_manager_onboarding_sessions")
    .update({
      sent_at: new Date().toISOString(),
      send_count: Number(data?.send_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sessionId);

  return { emailed: sent.emailed, texted: sent.texted };
}

/** Sessions an admin should look at: stalled, or carrying a flag/add request. */
export async function pmOnboardingAttention(supabase: Admin): Promise<Row[]> {
  const { data } = await supabase
    .from("property_manager_onboarding_sessions_v1")
    .select("*")
    .eq("status", "active")
    .order("idle_hours", { ascending: false })
    .limit(200);
  return ((data || []) as Row[]).filter(
    (r) => r.stalled === true || Number(r.pending_items || 0) > 0,
  );
}

/** Units awaiting a human price, oldest first — the review queue. */
export async function pmUnitsAwaitingReview(supabase: Admin): Promise<Row[]> {
  const { data } = await supabase
    .from("property_manager_units")
    .select(`${UNIT_COLS}, property_manager_accounts!inner(company_name, email)`)
    .eq("status", "pending_review")
    .order("created_at", { ascending: true })
    .limit(200);
  return (data || []) as Row[];
}
