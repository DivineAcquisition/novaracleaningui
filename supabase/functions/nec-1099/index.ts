// Form 1099-NEC (Rev. December 2026) — Copy B and Copy C.
//
// Amounts come from the pay ledger and cleaner_tips. Recipient lines come
// from the validated W-9 row. Payer identity and the Treasury Tipped
// Occupation Code come from app_settings. A generate or correct request
// cannot retype those fields.
//
// Copy A is the e-file record on the row. It is not a PDF.
// A correction inserts a new row linked to the original. The original is
// not updated.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildNec1099Pdf } from "../_shared/nec-1099-pdf.ts";
import {
  NEC_1099_PAYER_SETTING,
  NEC_1099_TTOC_SETTING,
  NEC_ELIGIBILITY_THRESHOLD_CENTS,
  assembleNecForm,
  blockerMessage,
  correctionOf,
  efileRecord,
  crewBreakdownContains,
  jobPayFromLedgers,
  meetsNecThreshold,
  parseTtocSetting,
  printableCopy,
  tipsFromLedger,
  ttocForTips,
  validatePayer,
  validateRecipient,
  type ExtraPayRow,
  type LedgerPayout,
  type Nec1099Form,
  type TipRow,
  type TtocSetting,
} from "../_shared/nec-1099.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// deno-lint-ignore no-explicit-any
type DB = any;

async function ensureAdmin(admin: DB, req: Request): Promise<string> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("Not signed in.");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
  if (!(roles || []).some((role: { role: string }) => role.role === "admin")) {
    throw new Error("Admins only.");
  }
  return userId;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

async function readSetting(admin: DB, key: string): Promise<unknown> {
  const { data, error } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(error.message || "Could not read filing settings.");
  return data?.value ?? null;
}

const LEDGER_PAGE = 1000;
const LEDGER_CAP = 20000;

async function readPages(label: string, build: () => DB): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; rows.length < LEDGER_CAP; from += LEDGER_PAGE) {
    const { data, error } = await build().range(from, from + LEDGER_PAGE - 1);
    if (error) throw new Error(error.message || `Could not read ${label}.`);
    const batch = (data || []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < LEDGER_PAGE) return rows;
  }
  throw new Error("A pay ledger read hit its limit. Refusing to file a partial 1099.");
}

async function loadLedgers(admin: DB, cleanerId: string, year: number) {
  const payoutSelect = "id, cleaner_id, amount_cents, status, service_date, paid_at, created_at, cleaner_breakdown";
  const [payoutsByCleaner, payoutsByCrew, extras, tips] = await Promise.all([
    readPages("the pay ledger", () =>
      admin.from("manual_payouts").select(payoutSelect).eq("status", "paid").eq("cleaner_id", cleanerId).order("id"),
    ),
    readPages("crew payouts", () =>
      admin
        .from("manual_payouts")
        .select(payoutSelect)
        .eq("status", "paid")
        .contains("cleaner_breakdown", crewBreakdownContains(cleanerId))
        .order("id"),
    ),
    readPages("extra pay", () =>
      admin
        .from("job_extra_pay")
        .select("id, cleaner_id, status, paid_at, created_at, surge_cents, job_value_cents, overtime_cents, supply_cents, mileage_cents")
        .eq("cleaner_id", cleanerId)
        .eq("status", "paid")
        .order("id"),
    ),
    readPages("tips", () =>
      admin
        .from("cleaner_tips")
        .select("id, cleaner_id, amount_cents, status, created_at, paid_out_at")
        .eq("cleaner_id", cleanerId)
        .order("id"),
    ),
  ]);
  const payouts: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const row of [...payoutsByCleaner, ...payoutsByCrew]) {
    const id = String((row as { id?: string }).id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    payouts.push(row as Record<string, unknown>);
  }
  const payoutRows: LedgerPayout[] = payouts.map((row: Record<string, unknown>) => ({
    cleanerId: row.cleaner_id as string | null,
    amountCents: row.amount_cents as number | null,
    status: row.status as string | null,
    serviceDate: row.service_date as string | null,
    paidAt: row.paid_at as string | null,
    createdAt: row.created_at as string | null,
    breakdown: row.cleaner_breakdown,
  }));
  const extraRows: ExtraPayRow[] = extras.map((row: Record<string, unknown>) => ({
    status: row.status as string | null,
    paidAt: row.paid_at as string | null,
    createdAt: row.created_at as string | null,
    surgeCents: row.surge_cents as number | null,
    jobValueCents: row.job_value_cents as number | null,
    overtimeCents: row.overtime_cents as number | null,
    supplyCents: row.supply_cents as number | null,
    mileageCents: row.mileage_cents as number | null,
  }));
  const tipRows: TipRow[] = tips.map((row: Record<string, unknown>) => ({
    amountCents: row.amount_cents as number | null,
    status: row.status as string | null,
    createdAt: row.created_at as string | null,
    paidOutAt: row.paid_out_at as string | null,
  }));
  const job = jobPayFromLedgers({ cleanerId, year, payouts: payoutRows, extras: extraRows });
  const tipCents = tipsFromLedger(tipRows, year);
  return { ...job, tipCents };
}

async function loadW9(admin: DB, cleanerId: string) {
  const { data, error } = await admin.from("cleaner_w9").select("*").eq("cleaner_id", cleanerId).maybeSingle();
  if (error) throw new Error(error.message || "Could not read the W-9.");
  if (!data?.validated_at) return null;
  return {
    name: data.legal_name,
    tin: data.tin,
    tinType: data.tin_type,
    street: data.street,
    city: data.city,
    state: data.state,
    zip: data.zip,
  };
}

function payerDraft(value: unknown) {
  const src = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const text = (key: string) => String(src[key] ?? "").replace(/\s+/g, " ").trim();
  return {
    name: text("name") || "NovaraCleaning LLC",
    tin: text("tin"),
    street: text("street"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    phone: text("phone"),
  };
}

function recipientFromBody(body: unknown) {
  const src = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return validateRecipient({
    name: src.legalName ?? src.legal_name ?? src.name,
    tin: src.tin,
    tinType: src.tinType ?? src.tin_type,
    street: src.street,
    city: src.city,
    state: src.state,
    zip: src.zip,
  });
}

async function signedInUser(req: Request): Promise<{ id: string; email: string }> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("Not signed in.");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data } = await userClient.auth.getUser();
  const user = data?.user;
  if (!user?.id) throw new Error("Not signed in.");
  return { id: user.id, email: String(user.email || "").toLowerCase() };
}

async function cleanerForContractor(admin: DB, user: { id: string; email: string }): Promise<{ id: string }> {
  const { data, error } = await admin.from("cleaners").select("id").eq("user_id", user.id).maybeSingle();
  if (error) throw new Error(error.message || "Could not find your contractor profile.");
  if (data?.id) return { id: data.id };
  if (!user.email) throw new Error("Contractor profile not found.");
  const { data: byEmail, error: emailErr } = await admin
    .from("cleaners")
    .select("id")
    .ilike("email", user.email)
    .is("user_id", null)
    .maybeSingle();
  if (emailErr) throw new Error(emailErr.message || "Could not find your contractor profile.");
  if (!byEmail?.id) throw new Error("Contractor profile not found.");
  const now = new Date().toISOString();
  const { data: linked, error: linkErr } = await admin
    .from("cleaners")
    .update({ user_id: user.id, updated_at: now })
    .eq("id", byEmail.id)
    .select("id")
    .single();
  if (linkErr || !linked?.id) throw new Error(linkErr?.message || "Contractor profile not found.");
  return { id: linked.id };
}

async function saveValidatedW9(
  admin: DB,
  cleanerId: string,
  recipient: { name: string; tin: string; tinType: string; street: string; city: string; state: string; zip: string },
  validatedBy: string,
) {
  const now = new Date().toISOString();
  const { error } = await admin.from("cleaner_w9").upsert({
    cleaner_id: cleanerId,
    legal_name: recipient.name,
    tin: recipient.tin,
    tin_type: recipient.tinType,
    street: recipient.street,
    city: recipient.city,
    state: recipient.state,
    zip: recipient.zip,
    validated_at: now,
    validated_by: validatedBy,
    updated_at: now,
  });
  if (error) throw new Error(error.message || "Could not save the W-9.");
  const { error: flagErr } = await admin
    .from("cleaners")
    .update({
      w9_status: "complete",
      w9_followup_required: false,
      updated_at: now,
    })
    .eq("id", cleanerId);
  if (flagErr) throw new Error(flagErr.message || "Could not mark the W-9 complete.");
}

function maskTin(tin: string): string {
  const digits = String(tin || "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `***-**-${digits.slice(-4)}`;
}

async function existingForms(admin: DB, cleanerId: string, year: number) {
  const { data, error } = await admin
    .from("nec_1099_forms")
    .select("id, corrected, corrects_form_id, created_at, box_1a_cents, box_1b_cents, box_1c_codes")
    .eq("cleaner_id", cleanerId)
    .eq("tax_year", year)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message || "Could not read filed 1099s.");
  const rows = data || [];
  const original = rows.find((row: { corrected: boolean }) => !row.corrected) || null;
  const corrections = rows.filter((row: { corrected: boolean }) => row.corrected);
  return { original, corrections };
}

async function buildForm(
  admin: DB,
  cleanerId: string,
  year: number,
  corrected: boolean,
  correctsFormId: string | null,
): Promise<{ ok: true; form: Nec1099Form; ledgers: { jobPayCents: number; tipCents: number; overtimeTrackedCents: number } } | { ok: false; status: number; error: string }> {
  const [ledgers, payerValue, ttocValue, w9] = await Promise.all([
    loadLedgers(admin, cleanerId, year),
    readSetting(admin, NEC_1099_PAYER_SETTING),
    readSetting(admin, NEC_1099_TTOC_SETTING),
    loadW9(admin, cleanerId),
  ]);
  const ttoc: TtocSetting = parseTtocSetting(ttocValue);
  const assembled = assembleNecForm({
    taxYear: year,
    corrected,
    correctsFormId,
    accountNumber: cleanerId,
    payer: payerValue,
    recipient: w9,
    jobPayCents: ledgers.jobPayCents,
    tipCents: ledgers.tipCents,
    ttoc,
    qualifiedOvertimePremiumCents: null,
    excessGoldenParachuteCents: null,
    federalWithheldCents: null,
    stateLines: [],
    allowBelowThreshold: corrected,
  });
  if (!assembled.ok) {
    return { ok: false, status: 400, error: blockerMessage(assembled.reason, assembled.missing) };
  }
  return {
    ok: true,
    form: assembled.form,
    ledgers: {
      jobPayCents: ledgers.jobPayCents,
      tipCents: ledgers.tipCents,
      overtimeTrackedCents: ledgers.overtimeTrackedCents,
    },
  };
}

async function insertForm(admin: DB, cleanerId: string, form: Nec1099Form, actor: string) {
  const [copyB, copyC] = await Promise.all([buildNec1099Pdf(form, "B"), buildNec1099Pdf(form, "C")]);
  const record = {
    cleaner_id: cleanerId,
    tax_year: form.taxYear,
    form_revision: form.revision,
    corrected: form.corrected,
    corrects_form_id: form.correctsFormId,
    account_number: form.accountNumber,
    job_pay_cents: form.jobPayCents,
    tip_cents: form.tipCents,
    combined_cents: form.combinedCents,
    box_1a_cents: form.box1aCents,
    box_1b_cents: form.box1bCents,
    box_1c_codes: form.box1cCodes,
    box_1d_cents: form.box1dCents,
    box_3_cents: form.box3Cents,
    box_4_cents: form.box4Cents,
    state_lines: form.stateLines,
    payer: form.payer,
    recipient: form.recipient,
    efile: efileRecord(form),
    copy_b_pdf: toBase64(copyB),
    copy_c_pdf: toBase64(copyC),
    created_by: actor,
  };
  const { data, error } = await admin.from("nec_1099_forms").insert(record).select("id, created_at, corrected, corrects_form_id").single();
  if (error) throw new Error(error.message || "Could not retain the 1099.");
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body?.action || "preview").toLowerCase();

    // Contractor onboarding. Resolved from the signed-in user, never from a
    // cleaner id in the body, and answered before the admin check.
    if (action === "submit_w9" || action === "w9_summary") {
      const user = await signedInUser(req);
      const cleaner = await cleanerForContractor(admin, user);
      if (action === "w9_summary") {
        const w9 = await loadW9(admin, cleaner.id);
        if (!w9) return json({ ok: true, onFile: false });
        return json({
          ok: true,
          onFile: true,
          legalName: w9.name,
          tinLast4: String(w9.tin).replace(/\D/g, "").slice(-4),
          street: w9.street,
          city: w9.city,
          state: w9.state,
          zip: w9.zip,
        });
      }
      if (body.certified !== true) {
        return json({ error: "Confirm that the name, address, and taxpayer identification number are correct." }, 400);
      }
      const submitted = recipientFromBody(body);
      if (!submitted.ok) return json({ error: blockerMessage(submitted.reason) }, 400);
      await saveValidatedW9(admin, cleaner.id, submitted.recipient, user.id);
      return json({
        ok: true,
        legalName: submitted.recipient.name,
        tinLast4: submitted.recipient.tin.replace(/\D/g, "").slice(-4),
      });
    }

    const actor = await ensureAdmin(admin, req);
    const cleanerId = String(body?.cleanerId || body?.cleaner_id || "").trim();
    const year = Math.round(Number(body?.taxYear || body?.tax_year) || 2026);

    if (action === "save_settings") {
      if (!body?.payer && !body?.ttoc) return json({ error: "Nothing to save." }, 400);
      if (body?.payer) {
        const payer = validatePayer(body.payer);
        if (!payer.ok) return json({ error: blockerMessage("payer_incomplete", payer.missing) }, 400);
        const { error } = await admin.from("app_settings").upsert({
          key: NEC_1099_PAYER_SETTING,
          value: payer.payer,
          description: "Payer identity for Form 1099-NEC. Street, city, state, and ZIP are separate. TIN is the EIN.",
        });
        if (error) throw new Error(error.message || "Could not save the payer.");
      }
      if (body?.ttoc) {
        const ttoc = parseTtocSetting(body.ttoc);
        if (ttoc.confirmed) {
          const confirmed = ttocForTips(ttoc, 1);
          if (!confirmed.ok) return json({ error: blockerMessage(confirmed.reason) }, 400);
        }
        const { error } = await admin.from("app_settings").upsert({
          key: NEC_1099_TTOC_SETTING,
          value: { codes: ttoc.codes, confirmed: ttoc.confirmed === true },
          description: "Accountant-confirmed Treasury Tipped Occupation Code for Form 1099-NEC box 1c. Empty until confirmed.",
        });
        if (error) throw new Error(error.message || "Could not save the occupation code.");
      }
      return json({ ok: true });
    }

    if (!cleanerId) return json({ error: "A contractor is required." }, 400);

    if (action === "save_w9") {
      const recipient = recipientFromBody(body);
      if (!recipient.ok) return json({ error: blockerMessage(recipient.reason) }, 400);
      await saveValidatedW9(admin, cleanerId, recipient.recipient, actor);
      return json({ ok: true, tinLast4: recipient.recipient.tin.replace(/\D/g, "").slice(-4) });
    }

    if (action === "preview") {
      const [ledgers, payerValue, ttocValue, w9, filed] = await Promise.all([
        loadLedgers(admin, cleanerId, year),
        readSetting(admin, NEC_1099_PAYER_SETTING),
        readSetting(admin, NEC_1099_TTOC_SETTING),
        loadW9(admin, cleanerId),
        existingForms(admin, cleanerId, year),
      ]);
      const ttoc = parseTtocSetting(ttocValue);
      const payer = validatePayer(payerValue);
      const recipient = validateRecipient(w9);
      const box1aCents = ledgers.jobPayCents + ledgers.tipCents;
      const box1bCents = ledgers.tipCents > 0 ? ledgers.tipCents : null;
      const occupation = ttocForTips(ttoc, ledgers.tipCents);
      const blockers: string[] = [];
      if (!meetsNecThreshold(ledgers.jobPayCents, ledgers.tipCents)) blockers.push(blockerMessage("below_threshold"));
      if (!recipient.ok) blockers.push(blockerMessage("w9_required"));
      if (!payer.ok) blockers.push(blockerMessage("payer_incomplete", payer.missing));
      if (ledgers.tipCents > 0 && !occupation.ok) blockers.push(blockerMessage(occupation.reason));
      return json({
        taxYear: year,
        thresholdCents: NEC_ELIGIBILITY_THRESHOLD_CENTS,
        jobPayCents: ledgers.jobPayCents,
        tipCents: ledgers.tipCents,
        combinedCents: ledgers.jobPayCents + ledgers.tipCents,
        eligible: meetsNecThreshold(ledgers.jobPayCents, ledgers.tipCents),
        box1aCents,
        box1bCents,
        box1cCodes: occupation.ok ? occupation.codes : null,
        box1dCents: null,
        box3Cents: null,
        overtimeTrackedCents: ledgers.overtimeTrackedCents,
        w9: recipient.ok ? { validated: true, legalName: recipient.recipient.name, tinMasked: maskTin(recipient.recipient.tin) } : { validated: false },
        payerReady: payer.ok,
        payer: payerDraft(payerValue),
        ttoc: { codes: ttoc.codes, confirmed: ttoc.confirmed },
        blockers,
        original: filed.original,
        corrections: filed.corrections,
      });
    }

    if (action === "generate") {
      const filed = await existingForms(admin, cleanerId, year);
      if (filed.original) {
        return json({
          ok: true,
          alreadyFiled: true,
          formId: filed.original.id,
          message: "The original 1099 is already on file and was not changed.",
        });
      }
      const built = await buildForm(admin, cleanerId, year, false, null);
      if (!built.ok) return json({ error: built.error }, built.status);
      const row = await insertForm(admin, cleanerId, built.form, actor);
      return json({ ok: true, alreadyFiled: false, formId: row.id, corrected: false });
    }

    if (action === "correct") {
      const filed = await existingForms(admin, cleanerId, year);
      const originalId = filed.original?.id || null;
      if (!originalId) return json({ error: "There is no original 1099 to correct." }, 400);
      const requested = String(body?.originalId || body?.correctsFormId || originalId);
      if (requested !== originalId && !filed.corrections.some((row: { id: string }) => row.id === requested)) {
        return json({ error: "That filing is not this contractor's 1099 for the year." }, 400);
      }
      const built = await buildForm(admin, cleanerId, year, true, originalId);
      if (!built.ok) return json({ error: built.error }, built.status);
      const linked = correctionOf(originalId, built.form);
      const row = await insertForm(admin, cleanerId, linked, actor);
      return json({ ok: true, formId: row.id, corrected: true, correctsFormId: originalId });
    }

    if (action === "open") {
      const formId = String(body?.formId || "").trim();
      const copy = printableCopy(String(body?.copy || "").toUpperCase());
      if (!copy) {
        return json({ error: "Copy A is filed electronically and is not generated as a PDF. Open Copy B or Copy C." }, 400);
      }
      if (!formId) return json({ error: "A filing is required." }, 400);
      const column = copy === "B" ? "copy_b_pdf" : "copy_c_pdf";
      const { data, error } = await admin
        .from("nec_1099_forms")
        .select(`id, tax_year, corrected, ${column}`)
        .eq("id", formId)
        .maybeSingle();
      if (error) throw new Error(error.message || "Could not open the 1099.");
      if (!data) return json({ error: "That 1099 is not on file." }, 404);
      const pdf = data[column];
      if (!pdf) return json({ error: "That copy was not retained." }, 404);
      return json({
        ok: true,
        formId: data.id,
        copy,
        taxYear: data.tax_year,
        corrected: data.corrected,
        filename: `1099-NEC-${data.tax_year}-Copy-${copy}${data.corrected ? "-corrected" : ""}.pdf`,
        pdf,
      });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The 1099 could not be prepared.";
    const status = /not signed in/i.test(message)
      ? 401
      : /admins only/i.test(message)
      ? 403
      : /contractor profile not found/i.test(message)
      ? 404
      : 500;
    return json({ error: message }, status);
  }
});
