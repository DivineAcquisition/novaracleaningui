// ─── /api/proposal/[token] ─────────────────────────────────────────────────
//
// The back end for the tokenized commercial proposal page.
//
//   GET  → the proposal as offered: every site, its rate, the cadence, the
//          term and the billing options. Records the view.
//   POST → accept, or request changes. Nothing else.
//
// THIS STAGE IS NON-BINDING, AND THAT IS ENFORCED HERE, NOT JUST IN THE UI.
// There is no branch in this file that accepts a signature, a card, a bank
// account, or any payment identifier. A client who reverse-engineers the
// endpoint still cannot sign or pay through it, because the capability does
// not exist on this route. Signing happens on the agreement's own link, after
// acceptance, against a document generated from what was accepted.
//
// The unguessable token is the credential — same trust model as the pay page,
// the contractor agreement link and the feedback link. The response contains
// only this account's own sites and rates, so a guessed token leaks nothing
// about anybody else.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  generateAgreement,
  row,
  PROPOSAL_COLS,
  PROPOSAL_SITE_COLS,
} from "@/lib/commercial-agreement-server";
import {
  agreementUrl,
  estimatedMonthlyCents,
  money,
  VALUE_STACK,
  type ProposalSite,
} from "@/lib/commercial-proposal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Resolved {
  ok: boolean;
  status: number;
  reason: string;
  message: string;
  proposal: Record<string, unknown> | null;
}

function refuse(status: number, reason: string, message: string): Resolved {
  return { ok: false, status, reason, message, proposal: null };
}

/**
 * Resolve a proposal link.
 *
 * Every rejection says which of the four things happened — wrong link, lapsed,
 * already accepted, already answered — because "invalid link" sends a
 * decision-maker to their account manager while "you accepted this on the 3rd"
 * ends the question on the page.
 */
async function resolveToken(token: string): Promise<Resolved> {
  if (!token || token.length < 32) {
    return refuse(404, "invalid", "This proposal link isn't valid.");
  }

  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("commercial_proposals")
    .select(PROPOSAL_COLS)
    .eq("token", token)
    .maybeSingle();
  const proposal = row<Record<string, unknown>>(data);

  if (!proposal) {
    return refuse(
      404,
      "invalid",
      "This proposal link is no longer active. If you've already responded, we have it — " +
        "your account manager will follow up with the next step.",
    );
  }

  const status = String(proposal.status || "");
  if (status === "accepted") {
    return refuse(
      409,
      "already_accepted",
      "You've already accepted this proposal. The service agreement is on its way to the authorized signer.",
    );
  }
  if (status === "changes_requested") {
    return refuse(
      409,
      "changes_requested",
      "Thanks — we have your requested changes and are preparing a revised proposal.",
    );
  }
  if (status === "withdrawn" || status === "superseded") {
    return refuse(
      410,
      "superseded",
      "This version of the proposal has been replaced. Check for a newer one, or reply to us and we'll resend it.",
    );
  }
  if (status !== "sent") {
    return refuse(404, "invalid", "This proposal link isn't valid.");
  }

  const expires = proposal.expires_at ? new Date(String(proposal.expires_at)).getTime() : 0;
  if (expires && expires < Date.now()) {
    return refuse(
      410,
      "expired",
      "This proposal has expired. Reply to the email and we'll send a refreshed version with current pricing.",
    );
  }

  return { ok: true, status: 200, reason: "ok", message: "", proposal };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const resolved = await resolveToken(token);
  if (!resolved.ok || !resolved.proposal) {
    return NextResponse.json(
      { ok: false, reason: resolved.reason, message: resolved.message },
      { status: resolved.status },
    );
  }

  const supabase = getAdminSupabase();
  const p = resolved.proposal;

  const [{ data: sites }, { data: account }] = await Promise.all([
    supabase
      .from("commercial_proposal_sites")
      .select(PROPOSAL_SITE_COLS)
      .eq("proposal_id", p.id as string)
      .order("sort_order"),
    supabase
      .from("business_accounts")
      .select("business_name, contact_name, city, state")
      .eq("id", p.business_account_id as string)
      .maybeSingle(),
  ]);

  // Record the read. Whether a proposal has been opened is the single most
  // useful thing to know before chasing it.
  await supabase
    .from("commercial_proposals")
    .update({
      first_viewed_at: p.first_viewed_at || new Date().toISOString(),
      last_viewed_at: new Date().toISOString(),
      view_count: Number(p.view_count || 0) + 1,
    })
    .eq("id", p.id as string);

  const rows = (sites || []) as unknown as ProposalSite[];

  return NextResponse.json({
    ok: true,
    proposal: {
      id: p.id,
      version: p.version,
      recipientName: p.recipient_name,
      proposedFrequency: p.proposed_frequency,
      term: p.term,
      billingMethod: p.billing_method,
      billingMethodLocked: p.billing_method_locked,
      invoiceCycle: p.invoice_cycle,
      netTerms: p.net_terms,
      coverNote: p.cover_note,
      totalPerVisitCents: p.total_per_visit_cents,
      estimatedMonthlyCents:
        p.estimated_monthly_cents ??
        estimatedMonthlyCents(rows, (p.proposed_frequency as string) || null),
      expiresAt: p.expires_at,
      preparedBy: p.prepared_by_name,
    },
    account: account || null,
    sites: rows,
    valueStack: VALUE_STACK,
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const resolved = await resolveToken(token);
  if (!resolved.ok || !resolved.proposal) {
    return NextResponse.json(
      { ok: false, reason: resolved.reason, message: resolved.message },
      { status: resolved.status },
    );
  }

  const supabase = getAdminSupabase();
  const p = resolved.proposal;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");

  const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const userAgent = req.headers.get("user-agent")?.slice(0, 400) || null;

  const { data: account } = await supabase
    .from("business_accounts")
    .select("id, business_name, contact_name, email, assigned_va_email")
    .eq("id", p.business_account_id as string)
    .maybeSingle();
  const acct = (account || {}) as Record<string, unknown>;

  // ── Request changes ────────────────────────────────────────────────────
  if (action === "request_changes") {
    const note = clip(body.note, 4000);
    if (note.length < 5) {
      return NextResponse.json(
        {
          ok: false,
          message: "Tell us what to change and we'll send a revised proposal.",
        },
        { status: 400 },
      );
    }
    const by = clip(body.name, 120) || (p.recipient_name as string) || "The client";

    // The version is kept exactly as it was sent and the link is retired.
    // A revision becomes a NEW version, so the negotiation stays readable
    // rather than being overwritten in place.
    const { error } = await supabase
      .from("commercial_proposals")
      .update({
        status: "changes_requested",
        changes_requested_at: new Date().toISOString(),
        change_request_note: note,
        change_request_by_name: by,
        token: null,
      })
      .eq("id", p.id as string);
    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
    }

    // Route it back to whoever owns the deal, with the reason attached.
    const owner =
      (p.assigned_to_email as string | null) ||
      (acct.assigned_va_email as string | null) ||
      null;
    if (owner) {
      await supabase.functions.invoke("admin-send-email", {
        body: {
          to: owner,
          subject: `Changes requested — ${String(acct.business_name || "commercial proposal")} (v${p.version})`,
          html: [
            `<p><strong>${by}</strong> asked for changes to proposal v${p.version} for <strong>${String(acct.business_name || "")}</strong>.</p>`,
            `<p style="border-left:3px solid #7c3aed;padding-left:12px;margin:16px 0;white-space:pre-wrap">${note.replace(/</g, "&lt;")}</p>`,
            `<p>Build the revised version in Commercial → Send Proposal. The current version has been retained and its link retired.</p>`,
          ].join(""),
        },
      });
    }

    await supabase.from("events").insert({
      event_type: "commercial.proposal.changes_requested",
      source: "commercial-proposal",
      summary:
        `${by} requested changes to proposal v${p.version} for ` +
        `${String(acct.business_name || "an account")}: ${note.slice(0, 240)}`,
      data: {
        proposal_id: p.id,
        account_id: p.business_account_id,
        version: p.version,
        note,
        assigned_to: owner,
      },
    });

    return NextResponse.json({
      ok: true,
      outcome: "changes_requested",
      message:
        "Thanks — that's with your account manager now. We'll send a revised proposal shortly.",
    });
  }

  // ── Accept ─────────────────────────────────────────────────────────────
  if (action === "accept") {
    const acceptedBy = clip(body.name, 120);
    if (acceptedBy.length < 2) {
      return NextResponse.json(
        { ok: false, message: "Please enter your name to record who accepted the proposal." },
        { status: 400 },
      );
    }

    // Which way they want to be billed. Locked proposals keep what was
    // offered; otherwise the client's pick on the page is what the agreement
    // and the billing profile are built around.
    const offered = String(p.billing_method || "invoiced");
    const chosen =
      p.billing_method_locked === true
        ? offered
        : body.billingMethod === "auto_pay"
          ? "auto_pay"
          : body.billingMethod === "invoiced"
            ? "invoiced"
            : offered;

    const { error } = await supabase
      .from("commercial_proposals")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by_name: acceptedBy,
        accepted_by_email: clip(body.email, 200) || (p.recipient_email as string) || null,
        accepted_billing_method: chosen,
        accepted_ip: ip,
        accepted_user_agent: userAgent,
        token: null,
      })
      .eq("id", p.id as string)
      .eq("status", "sent");
    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
    }

    // The whole point of acceptance: the Agreement is built now, pre-filled
    // from what was just accepted, with no human retyping any of it.
    const signerName = clip(body.signerName, 120) || acceptedBy;
    const signerEmail =
      clip(body.signerEmail, 200) ||
      clip(body.email, 200) ||
      (p.recipient_email as string) ||
      (acct.email as string) ||
      "";

    const built = await generateAgreement(supabase, {
      proposalId: String(p.id),
      signerName,
      signerEmail,
      signerTitle: clip(body.signerTitle, 120) || null,
      billingMethod: chosen as "auto_pay" | "invoiced",
      actorName: acceptedBy,
    });

    await supabase.from("events").insert({
      event_type: "commercial.proposal.accepted",
      source: "commercial-proposal",
      summary:
        `${acceptedBy} accepted proposal v${p.version} for ${String(acct.business_name || "an account")} — ` +
        `${money(Number(p.total_per_visit_cents || 0))} per visit, billed by ` +
        `${chosen === "auto_pay" ? "Auto-Pay" : "invoice"}.` +
        (built.ok ? " Agreement generated." : ` Agreement NOT generated: ${built.error}`),
      data: {
        proposal_id: p.id,
        account_id: p.business_account_id,
        version: p.version,
        accepted_by: acceptedBy,
        billing_method: chosen,
        agreement_id: built.agreementId || null,
        agreement_error: built.ok ? null : built.error,
      },
    });

    if (!built.ok) {
      // Acceptance stands regardless — it is the client's act, not ours. The
      // agreement gap is loud rather than silent so somebody picks it up.
      return NextResponse.json({
        ok: true,
        outcome: "accepted",
        agreementReady: false,
        message:
          "Thanks — your acceptance is recorded. Your account manager will send the service " +
          "agreement for signature shortly.",
      });
    }

    // Hand the signer straight to the document. If the signer is the person
    // already on the page, they continue without waiting for an email.
    const sameSigner =
      signerEmail && (p.recipient_email as string | null)
        ? signerEmail.toLowerCase() === String(p.recipient_email).toLowerCase()
        : true;

    if (signerEmail) {
      await supabase.functions.invoke("admin-send-email", {
        body: {
          to: signerEmail,
          subject: `Service agreement for signature — ${String(acct.business_name || "Novara Cleaning")}`,
          html: [
            `<p>Hi ${signerName},</p>`,
            `<p>Thanks for accepting the proposal. The Commercial Cleaning Services Agreement is ready to sign — it's pre-filled with everything you accepted, including the schedule of locations and rates in Exhibit A.</p>`,
            `<p><a href="${agreementUrl(String(built.token))}">Review and sign the agreement</a></p>`,
            chosen === "auto_pay"
              ? `<p>After signing you'll be asked to add a card or bank account for Auto-Pay. Nothing is charged at that point.</p>`
              : `<p>After signing you'll confirm the billing contact and invoicing terms. No payment details are collected.</p>`,
            `<p>— Novara Cleaning</p>`,
          ].join(""),
        },
      });
      await supabase
        .from("commercial_agreements")
        .update({ sent_at: new Date().toISOString(), sent_to: signerEmail, send_count: 1 })
        .eq("id", built.agreementId as string);
    }

    return NextResponse.json({
      ok: true,
      outcome: "accepted",
      agreementReady: true,
      // Only handed back when the signer is the person on the page. Otherwise
      // the link goes to the authorized signer by email and nowhere else.
      agreementUrl: sameSigner ? built.link : null,
      signerEmail: signerEmail || null,
      message: sameSigner
        ? "Accepted. Your service agreement is ready to sign."
        : `Accepted. The service agreement has been sent to ${signerEmail} for signature.`,
    });
  }

  return NextResponse.json(
    {
      ok: false,
      message:
        "This page can only accept a proposal or request changes to it. " +
        "Signing and billing happen on the agreement that follows.",
    },
    { status: 400 },
  );
}
