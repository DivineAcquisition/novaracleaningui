// ─── /api/cleaner/agreement/[token] ──────────────────────────────────────────
//
// The whole backend for the tokenized contractor agreement page. One job:
// let a contractor who has never signed an ICA read it and sign it, without an
// account, a wizard, or a password reset at 9pm.
//
//   GET  → who this link belongs to, whether it's already signed, and the
//          preview PDF so nobody is asked to sign something they can't read.
//   POST → create the completed DocuSeal submission, stamp the cleaner row,
//          and BURN the token.
//
// The unguessable token is the credential — the same trust model as the job
// checklist, offer response and photo upload links we already text. Two
// consequences that are deliberate rather than incidental:
//
//   * the token is single-use, so a forwarded text can't produce a second,
//     contradictory executed agreement;
//   * the response only ever contains this contractor's own name, email and
//     agreement state. A guessed token still leaks nothing about anybody else.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  sendAgreement,
  buildContractorValues,
  getAgreementPreviewUrl,
} from "@/lib/docuseal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CleanerRow {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  home_address: string | null;
  home_city: string | null;
  home_state: string | null;
  home_zip: string | null;
  status: string | null;
  ob_agreement_signed: boolean | null;
  ob_agreement_signed_at: string | null;
  agreement_token_expires_at: string | null;
}

const SELECT =
  "id, user_id, first_name, last_name, email, phone, home_address, home_city, " +
  "home_state, home_zip, status, ob_agreement_signed, ob_agreement_signed_at, " +
  "agreement_token_expires_at";

// Flat rather than a discriminated union: this project compiles with
// strictNullChecks off, where narrowing on a literal `ok` isn't dependable.
interface Outcome {
  ok: boolean;
  cleaner: CleanerRow | null;
  status: number;
  reason: string;
  message: string;
}

function refuse(status: number, reason: string, message: string): Outcome {
  return { ok: false, cleaner: null, status, reason, message };
}

/**
 * Resolve a signing link.
 *
 * Every rejection says which of the three things went wrong — wrong link,
 * expired link, already signed — because "invalid link" sends a contractor to
 * the support queue while "you already signed this on March 3rd" ends the
 * conversation on the page.
 */
async function resolveToken(token: string): Promise<Outcome> {
  if (!token || token.length < 20) {
    return refuse(404, "invalid", "This signing link isn't valid.");
  }

  const supabase = getAdminSupabase();
  const { data } = await (supabase.from as any)("cleaners")
    .select(SELECT)
    .eq("agreement_token", token)
    .maybeSingle();
  const cleaner = (data || null) as CleanerRow | null;

  if (!cleaner) {
    // A burned token is usually the SUCCESSFUL case, not an error: it means
    // they signed and then re-opened the text. Say that, rather than implying
    // they've done something wrong.
    return refuse(
      404,
      "invalid",
      "This signing link has already been used or is no longer valid. " +
        "If you've already signed, you're all set — nothing else is needed.",
    );
  }

  if (cleaner.ob_agreement_signed) {
    return refuse(409, "already_signed", "You've already signed your agreement — you're all set.");
  }

  if (
    cleaner.agreement_token_expires_at &&
    new Date(cleaner.agreement_token_expires_at).getTime() < Date.now()
  ) {
    return refuse(
      410,
      "expired",
      "This signing link has expired. Reply to our text and we'll send you a fresh one.",
    );
  }

  if (String(cleaner.status || "").toLowerCase() === "terminated") {
    return refuse(403, "inactive", "This link is no longer active.");
  }

  return { ok: true, cleaner, status: 200, reason: "ok", message: "" };
}

function displayName(c: CleanerRow): string {
  return `${c.first_name || ""} ${c.last_name || ""}`.trim();
}

function mailingAddress(c: CleanerRow): string {
  return [c.home_address, c.home_city, [c.home_state, c.home_zip].filter(Boolean).join(" ")]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join(", ");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const resolved = await resolveToken(token);

  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, reason: resolved.reason, error: resolved.message },
      { status: resolved.status },
    );
  }

  const c = resolved.cleaner;
  // The preview is best-effort: a DocuSeal outage must not stop somebody from
  // signing, but they should be told the document couldn't be shown rather
  // than being handed a blank frame.
  let previewUrl: string | null = null;
  try {
    previewUrl = (await getAgreementPreviewUrl("contractor")) || null;
  } catch {
    previewUrl = null;
  }

  return NextResponse.json({
    ok: true,
    cleaner: {
      firstName: c.first_name || "",
      lastName: c.last_name || "",
      name: displayName(c),
      email: c.email || "",
      phone: c.phone || "",
      address: mailingAddress(c),
    },
    previewUrl,
    expiresAt: c.agreement_token_expires_at,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const resolved = await resolveToken(token);

  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, reason: resolved.reason, error: resolved.message },
      { status: resolved.status },
    );
  }
  const c = resolved.cleaner;

  let body: { signatureDataUrl?: string; legalName?: string; address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const signature = String(body.signatureDataUrl || "").trim();
  if (!signature.startsWith("data:image/")) {
    return NextResponse.json({ error: "Please draw your signature before submitting." }, { status: 400 });
  }

  const email = String(c.email || "").trim();
  // Placeholder addresses are minted during bulk imports; DocuSeal would send
  // the executed copy into a void.
  if (!email || email.endsWith("@pending.novara")) {
    return NextResponse.json(
      {
        error:
          "We don't have a working email for you, and the signed copy has to go somewhere. " +
          "Reply to our text with your email and we'll re-send this link.",
      },
      { status: 409 },
    );
  }

  const name = displayName(c) || undefined;
  const legalName = String(body.legalName || "").trim() || name;
  const address = String(body.address || "").trim() || mailingAddress(c) || undefined;

  const supabase = getAdminSupabase();

  try {
    const result = await sendAgreement({
      audience: "contractor",
      email,
      name,
      values: buildContractorValues({
        name,
        legalName,
        email,
        phone: c.phone || undefined,
        address,
      }),
      signatureImage: signature,
      cleanerId: c.id,
      createdBy: "cleaner:agreement-link",
      metadata: { source: "tokenized-agreement-link", cleaner_id: c.id },
    });

    // Signed. Stamp the flags activation gates on and burn the token in the
    // same write, so a double-submit from a double-tap can't produce two
    // executed agreements.
    const signedAt = new Date().toISOString();
    const { error: upErr } = await (supabase.from as any)("cleaners")
      .update({
        ob_agreement_signed: true,
        ob_agreement_signed_at: signedAt,
        agreement_token: null,
        agreement_token_expires_at: null,
        updated_at: signedAt,
      })
      .eq("id", c.id);
    if (upErr) {
      // The agreement IS executed at DocuSeal, so this is not a failure to
      // report to the contractor — but ops needs to know the flag is stale.
      // eslint-disable-next-line no-console
      console.error("[cleaner/agreement] signed but flag update failed", upErr.message);
    }

    await supabase
      .from("events")
      .insert({
        event_type: "cleaner.agreement_signed",
        cleaner_id: c.id,
        source: "agreement-link",
        summary:
          `✍️ ${name || email} signed their contractor agreement via the tokenized link. ` +
          `Activation is no longer blocked on the ICA.`,
        data: {
          cleaner_id: c.id,
          submission_id: result.submissionId,
          via: "agreement_link",
        },
      })
      .then(() => undefined, () => undefined);

    // DocuSeal emails the executed PDF; the webhook backfills document_url on
    // the tracking row shortly after. Nothing to hand back but confirmation.
    return NextResponse.json({
      ok: true,
      signedAt,
      firstName: c.first_name || "",
      email,
    });
  } catch (err) {
    const message = (err as Error).message || "We couldn't file your agreement.";
    // eslint-disable-next-line no-console
    console.error("[cleaner/agreement] sign failed", message);
    return NextResponse.json(
      {
        error:
          "We couldn't file your agreement just now. Nothing was submitted — please try again in a minute.",
        detail: message,
      },
      { status: 502 },
    );
  }
}
