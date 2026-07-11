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
async function getSecret(supabase: any, key: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    if (data?.value) return String(data.value).trim();
  } catch { /* fall through */ }
  return (process.env[key] || "").trim();
}

// Fire a VA lifecycle event at the Zapier Catch Hook (ZAPIER_VA_HOOK_URL in
// app_secrets). No-ops silently until the hook is configured. Never throws.
// deno-lint-ignore no-explicit-any
async function sendVaZapier(supabase: any, event: string, row: Record<string, any>) {
  try {
    const hook = await getSecret(supabase, "ZAPIER_VA_HOOK_URL");
    if (!hook.startsWith("https://hooks.zapier.com/")) return;
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event, // va.submitted | va.approved | va.rejected | va.offboarded
        email: row.email,
        firstName: row.first_name || "",
        lastName: row.last_name || "",
        name: `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.email,
        phone: row.phone || "",
        vaRole: row.va_role,
        timezone: row.timezone || "",
        workingHours: row.working_hours || "",
        experience: row.experience || "",
        tools: row.tools || "",
        agreementSignedAt: row.agreement_signed_at || null,
        submittedAt: row.submitted_at || null,
        status: row.status,
        onboardingId: row.id,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn("[va-onboarding] zapier hook failed (non-blocking)", e instanceof Error ? e.message : String(e));
  }
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

      const discordInviteUrl = (await getSecret(supabase, "DISCORD_INVITE_URL")) || null;
      return NextResponse.json({ ok: true, ...summarize(row!), agreementPreviewUrl, discordInviteUrl });
    }

    // Everything below requires the row id minted by start.
    const id = String(body.id || "");
    if (!id) return bad("id required");
    const { data: row } = await supabase.from("va_onboarding").select("*").eq("id", id).maybeSingle();
    if (!row) return bad("Onboarding record not found", 404);

    // ── status ──────────────────────────────────────────────────────────
    if (action === "status") {
      const discordInviteUrl = (await getSecret(supabase, "DISCORD_INVITE_URL")) || null;
      return NextResponse.json({ ok: true, ...summarize(row), discordInviteUrl });
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

      const discordInviteUrl = (await getSecret(supabase, "DISCORD_INVITE_URL")) || null;
      return NextResponse.json({ ok: true, ...summarize(updated as Row), discordInviteUrl });
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

      // Zapier: VA lifecycle event for any external workflow (sheets, Slack…).
      void sendVaZapier(supabase, "va.submitted", updated as Row);

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

      const discordInviteUrl = (await getSecret(supabase, "DISCORD_INVITE_URL")) || null;
      return NextResponse.json({ ok: true, ...summarize(updated as Row), discordInviteUrl });
    }

    return bad("Unknown action");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[va-onboarding]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
