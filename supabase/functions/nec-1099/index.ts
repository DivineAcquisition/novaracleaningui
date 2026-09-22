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

async function loadLedgers(admin: DB, cleanerId: string, year: number) {
  const [{ data: payoutsByCleaner, error: payoutErr }, { data: payoutsByCrew, error: crewErr }, { data: extras, error: extraErr }, { data: tips, error: tipErr }] =
    await Promise.all([
      admin
        .from("manual_payouts")
        .select("id, cleaner_id, amount_cents, status, service_date, paid_at, created_at, cleaner_breakdown")
        .eq("status", "paid")
        .eq("cleaner_id", cleanerId)
        .limit(10000),
      admin
        .from("manual_payouts")
        .select("id, cleaner_id, amount_cents, status, service_date, paid_at, created_at, cleaner_breakdown")
        .eq("status", "paid")
        .contains("cleaner_breakdown", [{ cleanerId }])
        .limit(10000),
      admin
        .from("job_extra_pay")
        .select("cleaner_id, status, paid_at, created_at, surge_cents, job_value_cents, overtime_cents, supply_cents, mileage_cents")
        .eq("cleaner_id", cleanerId)
        .eq("status", "paid")
        .limit(10000),
      admin
        .from("cleaner_tips")
        .select("cleaner_id, amount_cents, status, created_at, paid_out_at")
        .eq("cleaner_id", cleanerId)
        .limit(10000),
    ]);
  if (payoutErr) throw new Error(payoutErr.message || "Could not read the pay ledger.");
  if (crewErr) throw new Error(crewErr.message || "Could not read crew payouts.");
  if (extraErr) throw new Error(extraErr.message || "Could not read extra pay.");
  if (tipErr) throw new Error(tipErr.message || "Could not read tips.");
  const payouts: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const row of [...(payoutsByCleaner || []), ...(payoutsByCrew || [])]) {
    const id = String((row as { id?: string }).id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    payouts.push(row as Record<string, unknown>);
  }
  if ((payoutsByCleaner || []).length >= 10000 || (payoutsByCrew || []).length >= 10000 || (extras || []).length >= 10000 || (tips || []).length >= 10000) {
    throw new Error("A pay ledger read hit its limit. Refusing to file a partial 1099.");
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
  const extraRows: ExtraPayRow[] = (extras || []).map((row: Record<string, unknown>) => ({
    status: row.status as string | null,
    paidAt: row.paid_at as string | null,
    createdAt: row.created_at as string | null,
    surgeCents: row.surge_cents as number | null,
    jobValueCents: row.job_value_cents as number | null,
    overtimeCents: row.overtime_cents as number | null,
    supplyCents: row.supply_cents as number | null,
    mileageCents: row.mileage_cents as number | null,
  }));
  const tipRows: TipRow[] = (tips || []).map((row: Record<string, unknown>) => ({
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
    const actor = await ensureAdmin(admin, req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "preview").toLowerCase();
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
      const recipient = validateRecipient({
        name: body?.legalName ?? body?.legal_name,
        tin: body?.tin,
        tinType: body?.tinType ?? body?.tin_type,
        street: body?.street,
        city: body?.city,
        state: body?.state,
        zip: body?.zip,
      });
      if (!recipient.ok) return json({ error: blockerMessage(recipient.reason) }, 400);
      const now = new Date().toISOString();
      const { error } = await admin.from("cleaner_w9").upsert({
        cleaner_id: cleanerId,
        legal_name: recipient.recipient.name,
        tin: recipient.recipient.tin,
        tin_type: recipient.recipient.tinType,
        street: recipient.recipient.street,
        city: recipient.recipient.city,
        state: recipient.recipient.state,
        zip: recipient.recipient.zip,
        validated_at: now,
        validated_by: actor,
        updated_at: now,
      });
      if (error) throw new Error(error.message || "Could not save the W-9.");
      return json({ ok: true, tinLast4: recipient.recipient.tin.slice(-4) });
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
    const status = /not signed in/i.test(message) ? 401 : /admins only/i.test(message) ? 403 : 500;
    return json({ error: message }, status);
  }
});
