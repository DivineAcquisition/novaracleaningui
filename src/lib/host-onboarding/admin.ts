// ─── Admin side of the host onboarding session ─────────────────────────────
//
// Sending a priced proposal is what mints the one tokenized link. Every
// property must already have a Company-set rate (Agreement §5.2). The host
// reviews that schedule; they never enter a rate.

import { onboardingUrl } from "./session";
import type { SnapshotProperty } from "./session";
import { sendPartnershipMessage } from "@/lib/partnership-comms/server";

// eslint-disable-next-line
type Admin = any;
type Row = Record<string, unknown>;

export interface StartHostOnboardingInput {
  hostId: string;
  actorName: string;
  recipientName?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  send?: boolean;
}

export interface StartHostOnboardingResult {
  ok: boolean;
  status: number;
  message?: string;
  sessionId?: string;
  token?: string;
  link?: string;
  emailed?: boolean;
  texted?: boolean;
}

function snapshotFromProperties(rows: Row[]): SnapshotProperty[] {
  return rows
    .map((p) => ({
      property_id: String(p.id),
      nickname: (p.nickname as string) || null,
      address: (p.address as string) || null,
      bedrooms: p.bedrooms == null ? null : Number(p.bedrooms),
      bathrooms: p.bathrooms == null ? null : Number(p.bathrooms),
      sqft: p.sqft == null ? null : Number(p.sqft),
      turnover_price: Number(p.turnover_price),
      linen: !!p.laundry_included,
      restock: !!p.restock_included,
      special_notes: (p.special_notes as string) || null,
    }))
    .filter((p) => Number.isFinite(p.turnover_price) && p.turnover_price > 0);
}

export async function mintHostToken(supabase: Admin): Promise<string> {
  const { data } = await supabase.rpc("mint_host_token");
  if (data && String(data).length >= 24) return String(data);
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const raw = Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return raw;
}

async function settingInt(supabase: Admin, key: string, fallback: number): Promise<number> {
  const { data } = await supabase.rpc("host_onboarding_setting_int", {
    p_key: key,
    p_default: fallback,
  });
  const n = Number(data);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function startHostOnboardingSession(
  supabase: Admin,
  input: StartHostOnboardingInput,
): Promise<StartHostOnboardingResult> {
  const { data: host } = await supabase.from("hosts").select("*").eq("id", input.hostId).maybeSingle();
  if (!host) return { ok: false, status: 404, message: "Host not found." };

  const { data: props } = await supabase.from("properties").select("*").eq("host_id", input.hostId);
  const propList = (props || []) as Row[];
  if (propList.length === 0) {
    return { ok: false, status: 409, message: "Host has no properties yet." };
  }
  const unpriced = propList.filter((p) => p.turnover_price == null || Number(p.turnover_price) <= 0);
  if (unpriced.length > 0) {
    return {
      ok: false,
      status: 409,
      message: "Set every property's rate before sending the agreement.",
    };
  }

  const snapshot = snapshotFromProperties(propList);
  if (snapshot.length === 0) {
    return { ok: false, status: 409, message: "Set every property's rate before sending the agreement." };
  }

  const { data: submission } = await supabase
    .from("host_onboarding_submissions")
    .select("id, full_name, email, phone")
    .eq("host_id", input.hostId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const recipientEmail =
    input.recipientEmail || (host.email as string) || (submission?.email as string) || null;
  const recipientName =
    input.recipientName || (host.name as string) || (submission?.full_name as string) || null;
  const recipientPhone =
    input.recipientPhone || (host.phone as string) || (submission?.phone as string) || null;

  if (!recipientEmail) {
    return { ok: false, status: 400, message: "No email to send the onboarding link to." };
  }

  await supabase
    .from("host_onboarding_sessions")
    .update({ status: "superseded", token: null, updated_at: new Date().toISOString() })
    .eq("host_id", input.hostId)
    .eq("status", "active");

  const token = await mintHostToken(supabase);
  const ttlDays = await settingInt(supabase, "session_ttl_days", 30);

  const { data: session, error } = await supabase
    .from("host_onboarding_sessions")
    .insert({
      host_id: input.hostId,
      submission_id: submission?.id || null,
      property_snapshot: snapshot,
      token,
      expires_at: new Date(Date.now() + ttlDays * 86400_000).toISOString(),
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      recipient_phone: recipientPhone,
      pay_after_enabled: !!host.pay_after_enabled,
      created_by_name: input.actorName,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: 400, message: error.message };

  if (submission?.id) {
    await supabase
      .from("host_onboarding_submissions")
      .update({ status: "agreement_sent" })
      .eq("id", submission.id);
  }

  const link = onboardingUrl(token);
  const result: StartHostOnboardingResult = {
    ok: true,
    status: 200,
    sessionId: String(session.id),
    token,
    link,
  };

  if (input.send !== false) {
    const sent = await sendHostOnboardingLink(supabase, {
      sessionId: String(session.id),
      hostName: String(host.name || recipientName || "there"),
      recipientName,
      recipientEmail,
      recipientPhone,
      link,
      hostId: input.hostId,
      rateSummary: snapshot
        .map((p) => `${p.nickname || p.address || "Property"}: $${p.turnover_price.toFixed(0)}/turnover`)
        .join("; "),
    });
    result.emailed = sent.emailed;
    result.texted = sent.texted;
  }

  await supabase.from("events").insert({
    event_type: "host.onboarding.started",
    source: "partner-admin",
    summary: `Host onboarding link sent to ${recipientEmail} by ${input.actorName}.`,
    data: { host_id: input.hostId, session_id: session.id },
  });

  return result;
}

export async function sendHostOnboardingLink(
  supabase: Admin,
  input: {
    sessionId: string;
    hostName: string;
    recipientName: string | null;
    recipientEmail: string;
    recipientPhone: string | null;
    link: string;
    rateSummary?: string;
    reminder?: boolean;
    hostId?: string | null;
  },
): Promise<{ emailed: boolean; texted: boolean }> {
  const name = (input.recipientName || "there").split(" ")[0];
  const rateHtml = input.rateSummary
    ? `<p style="background:#EDE9FE;border-radius:8px;padding:12px 14px;"><strong>Your rate schedule:</strong><br/>${input.rateSummary.replace(/</g, "&lt;")}</p>`
    : "";
  const sent = await sendPartnershipMessage(supabase, {
    templateKey: "host_onboarding_link",
    trigger: input.reminder ? "host-onboarding.reminder" : "host-onboarding.send",
    email: input.recipientEmail,
    phone: input.recipientPhone,
    hostId: input.hostId,
    vars: {
      first_name: name,
      link: input.link,
      rate_summary_html: rateHtml,
    },
    html: input.reminder
      ? [
        `<p>Hi ${name},</p>`,
        `<p>Just a nudge — your Host Partnership setup is part-finished and picks up exactly where you left off.</p>`,
        rateHtml,
        `<p><a href="${input.link}">Open your setup page</a></p>`,
        `<p>You don't have to do it all at once. The same link brings you back to where you stopped.</p>`,
      ].join("")
      : undefined,
    sms: input.reminder
      ? `Novara Cleaning: your host setup is part-finished — pick up where you left off: ${input.link}`
      : undefined,
  });
  const emailed = sent.emailed;
  const texted = sent.texted;

  const { data } = await supabase
    .from("host_onboarding_sessions")
    .select("send_count")
    .eq("id", input.sessionId)
    .maybeSingle();

  await supabase
    .from("host_onboarding_sessions")
    .update({
      sent_at: new Date().toISOString(),
      send_count: Number(data?.send_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sessionId);

  return { emailed, texted };
}

export async function hostOnboardingAttention(supabase: Admin): Promise<Row[]> {
  const { data } = await supabase
    .from("host_onboarding_sessions_v1")
    .select("*")
    .eq("status", "active")
    .order("idle_hours", { ascending: false })
    .limit(200);
  return ((data || []) as Row[]).filter(
    (r) => r.stalled === true || Number(r.pending_items || 0) > 0,
  );
}
