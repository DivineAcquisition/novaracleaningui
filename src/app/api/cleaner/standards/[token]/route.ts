// ─── /api/cleaner/standards/[token] ──────────────────────────────────────────
//
// The backend for the texted Contractor Standards acknowledgment page.
//
//   GET  → who this link belongs to, where they stand against the current
//          version, and when they last acknowledged one.
//   POST → record the acknowledgment and stamp the version on the contractor.
//
// The unguessable token is the credential, the same trust model as the job
// checklist, offer response and ICA signing links we already text. Two
// differences from the ICA link, both deliberate:
//
//   * the token is NOT burned. The standards are a reference document — the pet
//     rule and the chemical rule are things you want to re-read from the same
//     text message while standing in someone's kitchen. Replay is harmless: a
//     repeat acknowledgment of a version already acknowledged is idempotent.
//   * having acknowledged an older version does not close the page. It changes
//     the ask from "please read this" to "we've revised this", which is the
//     re-acknowledgment path the addendum exists for.
//
// A guessed token still leaks nothing about anybody else: the response only
// contains this contractor's own name and acknowledgment state.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  CONTRACTOR_STANDARDS_ACKNOWLEDGMENT,
  CONTRACTOR_STANDARDS_VERSION,
  standardsStanding,
  type StandardsStanding,
} from "@/lib/contractor-standards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CleanerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string | null;
  conduct_standards_version: string | null;
  conduct_standards_acknowledged_at: string | null;
  conduct_standards_token_expires_at: string | null;
}

const SELECT =
  "id, first_name, last_name, email, status, conduct_standards_version, " +
  "conduct_standards_acknowledged_at, conduct_standards_token_expires_at";

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

async function resolveToken(token: string): Promise<Outcome> {
  if (!token || token.length < 20) {
    return refuse(404, "invalid", "This link isn't valid.");
  }

  const supabase = getAdminSupabase();
  const { data } = await (supabase.from as any)("cleaners")
    .select(SELECT)
    .eq("conduct_standards_token", token)
    .maybeSingle();
  const cleaner = (data || null) as CleanerRow | null;

  if (!cleaner) {
    return refuse(
      404,
      "invalid",
      "This link is no longer valid. Reply to our text and we'll send you a fresh one.",
    );
  }

  if (
    cleaner.conduct_standards_token_expires_at &&
    new Date(cleaner.conduct_standards_token_expires_at).getTime() < Date.now()
  ) {
    return refuse(
      410,
      "expired",
      "This link has expired. Reply to our text and we'll send you a fresh one.",
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
  const standing: StandardsStanding = standardsStanding(c);

  return NextResponse.json({
    ok: true,
    cleaner: {
      firstName: c.first_name || "",
      name: displayName(c),
      email: c.email || "",
    },
    standing,
    currentVersion: CONTRACTOR_STANDARDS_VERSION,
    acknowledgedVersion: c.conduct_standards_version,
    acknowledgedAt: c.conduct_standards_acknowledged_at,
    expiresAt: c.conduct_standards_token_expires_at,
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

  let body: { signatureDataUrl?: string; legalName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const signature = String(body.signatureDataUrl || "").trim();
  if (!signature.startsWith("data:image/")) {
    return NextResponse.json(
      { error: "Please sign at the bottom before submitting." },
      { status: 400 },
    );
  }

  const legalName = String(body.legalName || "").trim() || displayName(c);
  if (legalName.length < 2) {
    return NextResponse.json({ error: "Please enter your full name." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const acknowledgedAt = new Date().toISOString();

  // Already acknowledged this exact version: say so and stop. Re-opening the
  // text after acknowledging is the common case, not an error, and writing a
  // second row would put two timestamps on one consent.
  if (standardsStanding(c) === "current") {
    return NextResponse.json({
      ok: true,
      alreadyAcknowledged: true,
      acknowledgedAt: c.conduct_standards_acknowledged_at,
      firstName: c.first_name || "",
    });
  }

  const previousVersion = c.conduct_standards_version;

  const { error: ackErr } = await (supabase.from as any)("cleaner_conduct_acknowledgments")
    .upsert(
      {
        cleaner_id: c.id,
        version: CONTRACTOR_STANDARDS_VERSION,
        acknowledged_at: acknowledgedAt,
        source: "standards_link",
        legal_name: legalName,
        signature_data_url: signature,
        acknowledgment_text: CONTRACTOR_STANDARDS_ACKNOWLEDGMENT,
        ip_address:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          req.headers.get("x-real-ip") ||
          null,
        user_agent: req.headers.get("user-agent"),
      },
      { onConflict: "cleaner_id,version" },
    );

  if (ackErr) {
    // eslint-disable-next-line no-console
    console.error("[cleaner/standards] acknowledgment insert failed", ackErr.message);
    return NextResponse.json(
      {
        error:
          "We couldn't record your acknowledgment just now. Nothing was saved — " +
          "please try again in a minute.",
      },
      { status: 502 },
    );
  }

  // The ledger row is the record; this is the copy the rest of the app reads.
  // The token is deliberately left alive so they can re-read the standards from
  // the same text message.
  const { error: upErr } = await (supabase.from as any)("cleaners")
    .update({
      conduct_standards_version: CONTRACTOR_STANDARDS_VERSION,
      conduct_standards_acknowledged_at: acknowledgedAt,
      updated_at: acknowledgedAt,
    })
    .eq("id", c.id);
  if (upErr) {
    // The acknowledgment IS on file, so this isn't a failure to report to the
    // contractor — but ops needs to know the denormalized column is stale, or
    // they'll chase somebody who has already done it.
    // eslint-disable-next-line no-console
    console.error("[cleaner/standards] acknowledged but version stamp failed", upErr.message);
  }

  await supabase
    .from("events")
    .insert({
      event_type: "cleaner.standards_acknowledged",
      cleaner_id: c.id,
      source: "standards-link",
      summary:
        `📋 ${legalName} acknowledged the Contractor Standards ` +
        `(${CONTRACTOR_STANDARDS_VERSION})` +
        (previousVersion ? ` — re-acknowledgment, was on ${previousVersion}.` : "."),
      data: {
        cleaner_id: c.id,
        version: CONTRACTOR_STANDARDS_VERSION,
        previous_version: previousVersion,
        via: "standards_link",
      },
    })
    .then(() => undefined, () => undefined);

  return NextResponse.json({
    ok: true,
    acknowledgedAt,
    version: CONTRACTOR_STANDARDS_VERSION,
    firstName: c.first_name || "",
  });
}
