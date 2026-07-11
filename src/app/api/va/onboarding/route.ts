// ─── POST /api/va/onboarding ─────────────────────────────────────────────────
//
// Public backend for the VA onboarding wizard on team.novaracleaning.com.
// The row id (uuid, returned to the same browser) is the session credential.
//
// Actions:
//   start  { email, firstName, lastName, phone, vaRole }
//          → upsert the pending record (identity step), returns
//            { id, status, agreementPreviewUrl } so the VA can READ the
//            agreement before signing.
//   sign   { id, legalName, signatureImage }
//          → executes the VA Independent Contractor Agreement via DocuSeal
//            (audience "va_contractor" — the existing template, fields mapped
//            by buildContractorValues; the drawn signature renders in the
//            document and the VA is emailed their completed copy).
//   submit { id, timezone, workingHours, experience, tools, notes }
//          → completes onboarding; row goes to 'submitted' (admin queue).
//            NO ACCESS IS PROVISIONED HERE — approval happens in the admin
//            workspace and is the only path that creates GHL/portal access.
//   status { id } → current step/status for resuming.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  sendAgreement,
  getAgreementPreviewUrl,
  buildContractorValues,
} from "@/lib/docuseal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VA_ROLES = new Set(["operations", "sales", "recruiting", "all"]);

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function summarize(r: Row) {
  return {
    id: r.id,
    status: r.status,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    vaRole: r.va_role,
    agreementSigned: !!r.agreement_signed_at,
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Row;
  try {
    body = (await req.json()) as Row;
  } catch {
    return bad("Invalid JSON body");
  }
  const action = String(body.action || "");
  const supabase = getAdminSupabase();

  try {
    // ── start: identity + role, mint/resume the pending record ─────────
    if (action === "start") {
      const email = String(body.email || "").trim().toLowerCase();
      const firstName = String(body.firstName || "").trim();
      const lastName = String(body.lastName || "").trim();
      const phone = String(body.phone || "").trim();
      const vaRole = String(body.vaRole || "operations");
      if (!email.includes("@")) return bad("A valid email is required — it's your identity key across every system.");
      if (!firstName) return bad("First name is required.");
      if (!VA_ROLES.has(vaRole)) return bad("Pick a role: operations, sales, recruiting, or all.");

      const { data: existing } = await supabase
        .from("va_onboarding")
        .select("*")
        .ilike("email", email)
        .maybeSingle();

      let row = existing as Row | null;
      if (row && ["approved", "offboarded"].includes(String(row.status))) {
        return bad("This email already has a completed onboarding — contact the office.", 409);
      }
      if (row) {
        const { data: updated, error } = await supabase
          .from("va_onboarding")
          .update({ first_name: firstName, last_name: lastName, phone: phone || null, va_role: vaRole, updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .select("*")
          .single();
        if (error) throw error;
        row = updated as Row;
      } else {
        const { data: created, error } = await supabase
          .from("va_onboarding")
          .insert({ email, first_name: firstName, last_name: lastName, phone: phone || null, va_role: vaRole, status: "started" })
          .select("*")
          .single();
        if (error) throw error;
        row = created as Row;
      }

      // Blank template preview so the VA can read the FULL agreement first.
      let agreementPreviewUrl: string | null = null;
      try {
        agreementPreviewUrl = await getAgreementPreviewUrl("va_contractor");
      } catch { /* preview is best-effort; signing still enforces the terms */ }

      return NextResponse.json({ ok: true, ...summarize(row!), agreementPreviewUrl });
    }

    // Everything below requires the row id minted by start.
    const id = String(body.id || "");
    if (!id) return bad("id required");
    const { data: row } = await supabase.from("va_onboarding").select("*").eq("id", id).maybeSingle();
    if (!row) return bad("Onboarding record not found", 404);

    // ── status ──────────────────────────────────────────────────────────
    if (action === "status") {
      return NextResponse.json({ ok: true, ...summarize(row) });
    }

    // ── sign: execute the VA Independent Contractor Agreement ──────────
    if (action === "sign") {
      if (row.agreement_signed_at) return NextResponse.json({ ok: true, ...summarize(row) });
      const legalName = String(body.legalName || "").trim();
      const signatureImage = String(body.signatureImage || "");
      if (legalName.length < 3) return bad("Type your full legal name.");
      if (!signatureImage.startsWith("data:image/")) return bad("Draw your signature to execute the agreement.");

      const fullName = `${row.first_name || ""} ${row.last_name || ""}`.trim() || legalName;
      const result = await sendAgreement({
        audience: "va_contractor",
        email: row.email,
        name: fullName,
        values: buildContractorValues({
          name: fullName,
          legalName,
          email: row.email,
          phone: row.phone || undefined,
        }),
        signatureImage,
        sendEmail: true, // VA receives their completed copy by email
        createdBy: "va-onboarding",
        metadata: { va_onboarding_id: row.id, va_role: row.va_role },
      });

      const { data: updated, error } = await supabase
        .from("va_onboarding")
        .update({
          status: "signed",
          agreement_submission_id: result.submissionId,
          agreement_signed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .select("*")
        .single();
      if (error) throw error;

      return NextResponse.json({ ok: true, ...summarize(updated as Row) });
    }

    // ── submit: onboarding form (only AFTER the signed agreement) ──────
    if (action === "submit") {
      if (!row.agreement_signed_at) return bad("Sign the agreement first — onboarding isn't complete without it.", 403);
      if (["approved", "offboarded", "rejected"].includes(String(row.status))) {
        return bad(`This onboarding is already ${row.status}.`, 409);
      }
      const timezone = String(body.timezone || "").trim();
      const workingHours = String(body.workingHours || "").trim();
      if (!timezone || !workingHours) return bad("Time zone and working hours are required.");

      const { data: updated, error } = await supabase
        .from("va_onboarding")
        .update({
          timezone,
          working_hours: workingHours,
          experience: String(body.experience || "").trim() || null,
          tools: String(body.tools || "").trim() || null,
          notes: String(body.notes || "").trim() || null,
          status: "submitted",
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .select("*")
        .single();
      if (error) throw error;

      // Ops visibility: Discord (routed) + best-effort admin email. Still NO access.
      const name = `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email;
      await supabase.from("events").insert({
        event_type: "va.onboarding_submitted",
        source: "va-onboarding",
        summary: `📝 VA onboarding submitted — ${name} (${row.email}, ${row.va_role}). Agreement signed. Awaiting approval in Admin → Team.`,
        data: { vaOnboardingId: row.id, email: row.email, vaRole: row.va_role },
      });
      try {
        const key = process.env.RESEND_API_KEY;
        if (key) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "Novara Team <hello@novaracleaning.com>",
              to: ["admin@novaracleaning.com"],
              subject: `VA onboarding pending approval — ${name} (${row.va_role})`,
              html: `<p><strong>${name}</strong> (${row.email}) finished VA onboarding for the <strong>${row.va_role}</strong> role and signed the VA Independent Contractor Agreement.</p><p>No access has been granted. Review &amp; approve in <a href="https://admin.novaracleaning.com/admin/team">Admin → Team</a>.</p>`,
            }),
          });
        }
      } catch { /* best-effort */ }

      return NextResponse.json({ ok: true, ...summarize(updated as Row) });
    }

    return bad("Unknown action");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[va-onboarding]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
