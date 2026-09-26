// Tokenized W-9 — no login. The link is the credential. The full TIN is
// accepted on submit and never returned.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { validateRecipient } from "@/lib/nec-1099";
import { postalStateCode } from "@/lib/us-states";
import { w9FieldErrors, w9LinkSummary } from "@/lib/w9-onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

function tokenOf(raw: string): string | null {
  const token = String(raw || "").trim();
  if (token.length < 32 || token.length > 128) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(token)) return null;
  return token;
}

async function loadByToken(token: string) {
  const supabase = getAdminSupabase();
  const { data, error } = await (supabase.from as any)("cleaners")
    .select(
      "id, first_name, last_name, email, status, home_address, home_city, state, home_zip, w9_status, w9_token_expires_at",
    )
    .eq("w9_token", token)
    .maybeSingle();
  return { supabase, cleaner: data, error };
}

function blocked(cleaner: { status?: string | null; w9_token_expires_at?: string | null }) {
  if (String(cleaner.status) === "terminated" || String(cleaner.status) === "resigned") {
    return NextResponse.json(
      { error: "This account is no longer active.", reason: String(cleaner.status) },
      { status: 409 },
    );
  }
  const expired =
    cleaner.w9_token_expires_at &&
    new Date(String(cleaner.w9_token_expires_at)).getTime() < Date.now();
  if (expired) {
    return NextResponse.json(
      { error: "This W-9 link has expired. Ask Novara to resend it.", reason: "expired" },
      { status: 410 },
    );
  }
  return null;
}

export async function GET(_req: Request, ctx: Ctx): Promise<NextResponse> {
  const token = tokenOf((await ctx.params).token);
  if (!token) {
    return NextResponse.json({ error: "Invalid W-9 link.", reason: "invalid" }, { status: 400 });
  }

  const { supabase, cleaner, error } = await loadByToken(token);
  if (error) {
    return NextResponse.json({ error: "Couldn't open this W-9 link.", reason: "error" }, { status: 500 });
  }
  if (!cleaner) {
    return NextResponse.json(
      { error: "This W-9 link isn't valid — ask Novara for a fresh one.", reason: "invalid" },
      { status: 404 },
    );
  }
  const stop = blocked(cleaner);
  if (stop) return stop;

  const { data: filed, error: w9Err } = await (supabase.from as any)("cleaner_w9")
    .select("legal_name, tin, street, city, state, zip")
    .eq("cleaner_id", cleaner.id)
    .maybeSingle();
  if (w9Err) {
    return NextResponse.json({ error: "Couldn't open this W-9 link.", reason: "error" }, { status: 500 });
  }
  const summary = cleaner.w9_status === "complete" ? w9LinkSummary(filed) : null;

  return NextResponse.json({
    ok: true,
    cleaner: {
      firstName: cleaner.first_name || "",
      lastName: cleaner.last_name || "",
    },
    prefill: {
      legalName: summary?.legalName || `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim(),
      street: summary?.street || cleaner.home_address || "",
      city: summary?.city || cleaner.home_city || "",
      state: summary?.state || postalStateCode(cleaner.state) || "",
      zip: summary?.zip || cleaner.home_zip || "",
    },
    onFile: Boolean(summary),
    summary,
    expiresAt: cleaner.w9_token_expires_at || null,
  });
}

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const token = tokenOf((await ctx.params).token);
  if (!token) {
    return NextResponse.json({ error: "Invalid W-9 link.", reason: "invalid" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { supabase, cleaner, error } = await loadByToken(token);
  if (error) {
    return NextResponse.json({ error: "Couldn't open this W-9 link.", reason: "error" }, { status: 500 });
  }
  if (!cleaner) {
    return NextResponse.json(
      { error: "This W-9 link isn't valid — ask Novara for a fresh one.", reason: "invalid" },
      { status: 404 },
    );
  }
  const stop = blocked(cleaner);
  if (stop) return stop;

  if (body.certified !== true) {
    return NextResponse.json(
      { error: "Confirm that the name, address, and taxpayer identification number are correct." },
      { status: 400 },
    );
  }

  const draft = {
    legalName: String(body.legalName || body.name || ""),
    tinType: String(body.tinType || ""),
    tin: String(body.tin || ""),
    street: String(body.street || ""),
    city: String(body.city || ""),
    state: String(body.state || ""),
    zip: String(body.zip || ""),
  };
  const fieldErrors = w9FieldErrors(draft);
  if (fieldErrors.length > 0) {
    return NextResponse.json({ error: fieldErrors.join(" ") }, { status: 400 });
  }
  const checked = validateRecipient({
    name: draft.legalName,
    tinType: draft.tinType,
    tin: draft.tin,
    street: draft.street,
    city: draft.city,
    state: postalStateCode(draft.state),
    zip: draft.zip,
  });
  if (checked.ok === false) {
    return NextResponse.json(
      { error: "Check the name, address, and taxpayer identification number, then try again." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const recipient = checked.recipient;
  const { error: saveErr } = await (supabase.from as any)("cleaner_w9").upsert({
    cleaner_id: cleaner.id,
    legal_name: recipient.name,
    tin: recipient.tin,
    tin_type: recipient.tinType,
    street: recipient.street,
    city: recipient.city,
    state: recipient.state,
    zip: recipient.zip,
    validated_at: now,
    validated_by: null,
    updated_at: now,
  });
  if (saveErr) {
    console.error("[w9-token] save failed");
    return NextResponse.json({ error: "Couldn't save the W-9." }, { status: 500 });
  }

  const { error: flagErr } = await (supabase.from as any)("cleaners")
    .update({
      w9_status: "complete",
      w9_followup_required: false,
      updated_at: now,
    })
    .eq("id", cleaner.id);
  if (flagErr) {
    console.error("[w9-token] status update failed");
    return NextResponse.json({ error: "Couldn't save the W-9." }, { status: 500 });
  }

  const tinLast4 = recipient.tin.replace(/\D/g, "").slice(-4);
  await supabase
    .from("events")
    .insert({
      event_type: "cleaner.w9_submitted",
      cleaner_id: cleaner.id,
      source: "cleaner-w9-token",
      summary: `W-9 submitted by ${`${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "a contractor"} via the W-9 link`,
      data: { tokenized: true, tin_last4: tinLast4 },
    })
    .then(() => undefined, () => undefined);

  return NextResponse.json({
    ok: true,
    legalName: recipient.name,
    tinLast4,
    street: recipient.street,
    city: recipient.city,
    state: recipient.state,
    zip: recipient.zip,
  });
}
