// ─── Admin side of the onboarding session ──────────────────────────────────
//
// Approving an account for onboarding is where the BILLING DECISION is made.
// That is deliberate and it is the main change this adjustment introduces: the
// client is no longer asked mid-flow how they'd like to be billed, because
// that answer depends on things they shouldn't have to reason about — account
// size, what we do for that account type, whether their AP department will
// accept a card at all.
//
// So an onboarding link cannot be generated without a method selected, and the
// method is stored on the ACCOUNT so it survives the session and drives a
// targeted re-setup if it later changes.

import { onboardingUrl } from "./session";
import { sendPartnershipMessage } from "@/lib/partnership-comms";

// eslint-disable-next-line
type Admin = any;
type Row = Record<string, unknown>;

export type BillingMethod = "auto_pay" | "invoiced";

export interface StartOnboardingInput {
  accountId: string;
  billingMethod: BillingMethod;
  /** Which proposal the client reviews. Defaults to the newest sendable one. */
  proposalId?: string | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  actorName: string;
  /** Email + text the link straight away. */
  send?: boolean;
}

export interface StartOnboardingResult {
  ok: boolean;
  status: number;
  message?: string;
  sessionId?: string;
  token?: string;
  link?: string;
  emailed?: boolean;
  texted?: boolean;
}

/**
 * Create the one link, replacing any previous live one.
 *
 * A re-issue supersedes rather than co-exists: two working entry points into
 * the same onboarding is how a client signs on one and configures billing on
 * the other, and nobody notices until dispatch refuses.
 */
export async function startOnboardingSession(
  supabase: Admin,
  input: StartOnboardingInput,
): Promise<StartOnboardingResult> {
  if (input.billingMethod !== "auto_pay" && input.billingMethod !== "invoiced") {
    return {
      ok: false,
      status: 400,
      message: "Choose how this account will be billed before sending the onboarding link.",
    };
  }

  const { data: account } = await supabase
    .from("business_accounts")
    .select("id, business_name, contact_name, email, phone, assigned_va_email")
    .eq("id", input.accountId)
    .maybeSingle();
  if (!account) return { ok: false, status: 404, message: "Account not found." };

  // The proposal the client will review. Without one there is nothing to
  // accept, and the session would open on an empty first step.
  let proposalId = input.proposalId || null;
  if (!proposalId) {
    const { data: proposal } = await supabase
      .from("commercial_proposals")
      .select("id, status")
      .eq("business_account_id", input.accountId)
      .in("status", ["draft", "sent", "accepted"])
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    proposalId = (proposal?.id as string) || null;
  }
  if (!proposalId) {
    return {
      ok: false,
      status: 409,
      message:
        "Build the proposal first — the onboarding session opens on the pricing review, so there has to be something to review.",
    };
  }

  // A proposal the client is meant to accept has to be in a sendable state.
  // The sent-shape constraint also requires a token, expiry and recipient, so
  // promote a draft properly rather than flipping status underneath it.
  const { data: proposal } = await supabase
    .from("commercial_proposals")
    .select("id, status, token, expires_at, recipient_name, recipient_email, version")
    .eq("id", proposalId)
    .maybeSingle();
  if (!proposal) return { ok: false, status: 404, message: "Proposal not found." };

  const recipientEmail =
    input.recipientEmail ||
    (proposal.recipient_email as string) ||
    (account.email as string) ||
    null;
  const recipientName =
    input.recipientName ||
    (proposal.recipient_name as string) ||
    (account.contact_name as string) ||
    null;

  if (!recipientEmail) {
    return { ok: false, status: 400, message: "No email to send the onboarding link to." };
  }

  if (proposal.status === "draft") {
    const { data: minted } = await supabase.rpc("mint_commercial_token");
    const { error } = await supabase
      .from("commercial_proposals")
      .update({
        status: "sent",
        // The proposal keeps a token of its own so the record satisfies its
        // sent-shape constraint, but it is never sent to the client — the
        // onboarding session is the only link that leaves the building.
        token: String(minted || ""),
        expires_at:
          (proposal.expires_at as string) ||
          new Date(Date.now() + 14 * 86400_000).toISOString(),
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        sent_at: new Date().toISOString(),
      })
      .eq("id", proposalId);
    if (error) return { ok: false, status: 400, message: error.message };
  }

  // Record the decision on the account. This outlives the session.
  await supabase
    .from("business_accounts")
    .update({
      preferred_billing_method: input.billingMethod,
      preferred_billing_method_set_at: new Date().toISOString(),
      preferred_billing_method_set_by: input.actorName,
    })
    .eq("id", input.accountId);

  // Retire any live session before opening a new one.
  await supabase
    .from("commercial_onboarding_sessions")
    .update({ status: "superseded", token: null, updated_at: new Date().toISOString() })
    .eq("business_account_id", input.accountId)
    .eq("status", "active");

  const { data: minted } = await supabase.rpc("mint_commercial_token");
  const token = String(minted || "");
  if (!token) return { ok: false, status: 500, message: "Could not mint an onboarding link." };

  const ttlDays = await settingInt(supabase, "session_ttl_days", 30);

  const { data: session, error } = await supabase
    .from("commercial_onboarding_sessions")
    .insert({
      business_account_id: input.accountId,
      proposal_id: proposalId,
      token,
      expires_at: new Date(Date.now() + ttlDays * 86400_000).toISOString(),
      billing_method: input.billingMethod,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      recipient_phone: input.recipientPhone || (account.phone as string) || null,
      created_by_name: input.actorName,
    })
    .select("id")
    .single();
  if (error) return { ok: false, status: 400, message: error.message };

  const link = onboardingUrl(token);
  const result: StartOnboardingResult = {
    ok: true,
    status: 200,
    sessionId: String(session.id),
    token,
    link,
  };

  if (input.send !== false) {
    const sent = await sendOnboardingLink(supabase, {
      sessionId: String(session.id),
      accountName: String(account.business_name || "your account"),
      recipientName,
      recipientEmail,
      recipientPhone: input.recipientPhone || (account.phone as string) || null,
      billingMethod: input.billingMethod,
      link,
      accountId: input.accountId,
    });
    result.emailed = sent.emailed;
    result.texted = sent.texted;
  }

  await supabase.from("events").insert({
    event_type: "commercial.onboarding.started",
    source: "admin-proposals",
    summary:
      `Onboarding link sent to ${recipientEmail} for ${String(account.business_name || "an account")} — ` +
      `billing set to ${input.billingMethod === "auto_pay" ? "Auto-Pay" : "invoiced"} by ${input.actorName}.`,
    data: {
      account_id: input.accountId,
      session_id: session.id,
      proposal_id: proposalId,
      billing_method: input.billingMethod,
    },
  });

  return result;
}

async function settingInt(supabase: Admin, key: string, fallback: number): Promise<number> {
  const { data } = await supabase.rpc("commercial_onboarding_setting_int", {
    p_key: key,
    p_default: fallback,
  });
  const n = Number(data);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface SendLinkInput {
  sessionId: string;
  accountName: string;
  recipientName: string | null;
  recipientEmail: string;
  recipientPhone: string | null;
  billingMethod: BillingMethod;
  link: string;
  /** Wording for a nudge rather than a first send. */
  reminder?: boolean;
  accountId?: string | null;
}

/** Email and, when we have a number, text the link. Same pattern as everywhere else. */
export async function sendOnboardingLink(
  supabase: Admin,
  input: SendLinkInput,
): Promise<{ emailed: boolean; texted: boolean }> {
  const name = (input.recipientName || "there").split(" ")[0];
  const sent = await sendPartnershipMessage(supabase, {
    templateKey: "commercial_onboarding_link",
    trigger: input.reminder ? "commercial-onboarding.reminder" : "commercial-onboarding.send",
    email: input.recipientEmail,
    phone: input.recipientPhone,
    accountId: input.accountId,
    vars: {
      first_name: name,
      business_name: input.accountName,
      link: input.link,
    },
    html: input.reminder
      ? [
        `<p>Hi ${name},</p>`,
        `<p>Just a nudge — setting up <strong>${input.accountName}</strong> is part-finished and picks up exactly where you left off.</p>`,
        `<p><a href="${input.link}">Open your setup page</a></p>`,
      ].join("")
      : undefined,
    sms: input.reminder
      ? `Novara Cleaning: your setup for ${input.accountName} is part-finished — pick up where you left off: ${input.link}`
      : undefined,
  });
  const emailed = sent.emailed;
  const texted = sent.texted;

  await supabase
    .from("commercial_onboarding_sessions")
    .update({
      sent_at: new Date().toISOString(),
      send_count: await nextSendCount(supabase, input.sessionId),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sessionId);

  return { emailed, texted };
}

async function nextSendCount(supabase: Admin, sessionId: string): Promise<number> {
  const { data } = await supabase
    .from("commercial_onboarding_sessions")
    .select("send_count")
    .eq("id", sessionId)
    .maybeSingle();
  return Number(data?.send_count || 0) + 1;
}

/**
 * The billing method changed after onboarding. Per the spec this is a
 * TARGETED re-setup, not a full re-onboarding — the client has already signed
 * and does not need to do it again.
 */
export async function changeBillingMethod(
  supabase: Admin,
  input: { accountId: string; billingMethod: BillingMethod; actorName: string },
): Promise<{ ok: boolean; status: number; message: string; link?: string }> {
  const { data: account } = await supabase
    .from("business_accounts")
    .select("id, business_name, contact_name, email, phone, preferred_billing_method")
    .eq("id", input.accountId)
    .maybeSingle();
  if (!account) return { ok: false, status: 404, message: "Account not found." };

  const { data: agreement } = await supabase
    .from("commercial_agreements")
    .select("id, status, token")
    .eq("business_account_id", input.accountId)
    .eq("status", "signed")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase
    .from("business_accounts")
    .update({
      preferred_billing_method: input.billingMethod,
      preferred_billing_method_set_at: new Date().toISOString(),
      preferred_billing_method_set_by: input.actorName,
    })
    .eq("id", input.accountId);

  // Reset the billing profile to the new method. `configured` is generated, so
  // clearing the method-specific fields is what makes the account read as
  // "billing pending" again — and the dispatch gate follows automatically.
  await supabase
    .from("commercial_billing_profiles")
    .upsert(
      {
        business_account_id: input.accountId,
        agreement_id: agreement?.id || null,
        method: input.billingMethod,
        ...(input.billingMethod === "invoiced"
          ? { stripe_payment_method_id: null, payment_method_type: null, setup_session_id: null }
          : { billing_contact_email: null, invoice_cycle: null, net_terms: null }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_account_id" },
    );

  await supabase.from("events").insert({
    event_type: "commercial.billing.method_changed",
    source: "admin-proposals",
    summary: `${input.actorName} changed billing for ${String(account.business_name || "an account")} to ${input.billingMethod === "auto_pay" ? "Auto-Pay" : "invoiced"}.`,
    data: {
      account_id: input.accountId,
      from: account.preferred_billing_method,
      to: input.billingMethod,
    },
  });

  // A targeted link so they only redo billing.
  if (!agreement?.id) {
    return {
      ok: true,
      status: 200,
      message: "Billing method updated. There's no signed agreement yet, so it applies to the onboarding already in flight.",
    };
  }

  const { data: minted } = await supabase.rpc("mint_commercial_token");
  const token = String(minted || "");
  await supabase
    .from("commercial_agreements")
    .update({
      token,
      billing_method: input.billingMethod,
      expires_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", agreement.id);

  return {
    ok: true,
    status: 200,
    message: "Billing method updated and a billing-only link is ready to send — they don't sign again.",
    link: token ? `${process.env.NEXT_PUBLIC_COMMERCIAL_ORIGIN || "https://commercial.novaracleaning.com"}/commercial-agreement/${token}` : undefined,
  };
}

/** Sessions an admin should look at: stalled, or with something waiting. */
export async function onboardingAttention(supabase: Admin): Promise<Row[]> {
  const { data } = await supabase
    .from("commercial_onboarding_sessions_v1")
    .select("*")
    .eq("status", "active")
    .order("idle_hours", { ascending: false })
    .limit(200);
  return ((data || []) as Row[]).filter(
    (r) => r.stalled === true || Number(r.pending_submissions || 0) > 0 || r.paused_for_changes === true,
  );
}
