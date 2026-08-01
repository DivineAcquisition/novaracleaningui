// qc-drive-mirror
//
// Async worker that mirrors each completed job's documentation to Google
// Drive. Runs every 10 minutes from pg_cron (and on demand from the QC
// console). Supabase is written first by the ensure_job_documentation
// trigger; this worker NEVER blocks job completion — a Drive outage just
// leaves the row pending/failed for the next pass.
//
// Per job it:
//   1. Refreshes the documentation snapshot (photos, checklist, cleaners).
//   2. Builds the Drive folder tree:
//        <QC root>/<YYYY>/<MM - Month>/<NVC-xxxxx — Client — date>/{before,after}
//   3. Uploads every ORIGINAL photo (deterministic filenames → retries dedupe).
//   4. Generates the completion-summary PDF (job details, real checkout +
//      agreement page screenshots, checklist, before/after photos, signed
//      agreement) — the one-file dispute/chargeback packet.
//   5. Marks the row mirrored, then pushes the Drive link + documented flag
//      to the job's Airtable record via the existing sync webhook.
//
// Failure → mirror_status='failed' with exponential backoff; after
// MAX_ATTEMPTS a qc.documentation.failed event alerts admin via Discord.
//
// Config: GDRIVE_QC_ROOT_FOLDER_ID (app_secrets or env) + the Google service
// account env vars shared with the Calendar integration.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import {
  driveConfigured,
  ensureFolder,
  fileUrl,
  folderUrl,
  getDriveToken,
  listChildNames,
  shareReadableByLink,
  updateFile,
  uploadFile,
} from "../_shared/google-drive.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}
const log = (s: string, d?: unknown) =>
  console.log(`[qc-drive-mirror] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

const BATCH_SIZE = 4;
const MAX_ATTEMPTS = 8;
// The dispute packet embeds EVERY before/after photo. A soft byte cap guards
// edge-function memory on pathological sets — photos beyond it are still in
// the Drive folders, and the packet notes the truncation.
const MAX_PDF_PHOTO_BYTES = 100 * 1024 * 1024;

// Policies the client agreed to at booking — cited BY SECTION against the
// live published policies so every claim in the packet maps to the exact
// clause. URLs included so a processor/adjuster can verify the source.
const POLICY_URLS: Array<{ label: string; url: string }> = [
  { label: "Terms of Service", url: "https://novaracleaning.com/terms" },
  { label: "Refund Policy", url: "https://novaracleaning.com/refund-policy" },
  { label: "Cancellation Policy", url: "https://novaracleaning.com/cancellation-policy" },
  { label: "Disclaimer", url: "https://novaracleaning.com/disclaimer" },
];

interface PolicyRef { claim: string; cite: string }
const POLICY_REFS: PolicyRef[] = [
  {
    claim: "Acceptance is binding on booking: clicking agree, submitting a booking, providing payment, or granting property access constitutes acceptance of all policies.",
    cite: "Terms of Service §1.2, §1.4",
  },
  {
    claim: "All sales are final once service has been rendered; completed-service payments are non-refundable outside the narrow stated exceptions.",
    cite: "Terms of Service §6.3 · Refund Policy §1.1",
  },
  {
    claim: "The primary and default remedy for any legitimate quality concern is a complimentary re-clean — not a refund.",
    cite: "Terms of Service §7.1, §7.3 · Refund Policy §1.2, §2.1",
  },
  {
    claim: "Concerns must be reported IN WRITING within 24 hours of completion, with specific itemized areas and timestamped photos; the property must be undisturbed.",
    cite: "Terms of Service §7.1 · Refund Policy §3.1–3.4",
  },
  {
    claim: "Subjective dissatisfaction, buyer's remorse, and services performed to the checklist standard are never refundable.",
    cite: "Terms of Service §6.4 · Refund Policy §5.1–5.2, §6 · Disclaimer §1.3",
  },
  {
    claim: "Tasks not included in the purchased package (e.g. inside fridge/oven, add-ons never booked) are not refundable events.",
    cite: "Refund Policy §5.7",
  },
  {
    claim: "Cancellations require 24-hour notice; late cancellations incur the published fee, and same-day cancellations / no-shows (including access failures caused by the customer) forfeit 100% of the service amount.",
    cite: "Cancellation Policy §1.1, §2.1–2.3, §10 · Terms of Service §6.1",
  },
  {
    claim: "Before initiating any chargeback the customer is contractually required to complete written dispute resolution and allow 72 hours for investigation; unauthorized chargebacks constitute material breach and fraud, with a $150 administrative fee plus full liability.",
    cite: "Terms of Service §10.1–10.4 · Refund Policy §8.2–8.5",
  },
  {
    claim: "The customer expressly consented to comprehensive service documentation — timestamped before/after photographs, GPS/service records, checklists, and communication logs — retained a minimum of four (4) years and usable in dispute resolution and chargeback defense.",
    cite: "Terms of Service §13.1–13.4 · Refund Policy §3.3, §9.2 · Disclaimer §8.4",
  },
  {
    claim: "Liability is capped at the amount actually paid for the service; damage claims must be reported within 24 hours.",
    cite: "Terms of Service §11.2–11.3",
  },
  {
    claim: "Memberships: recurring billing is authorized and cancellation requires 14 days' written notice before the next billing cycle.",
    cite: "Terms of Service §6.2 · Refund Policy §10.1",
  },
  {
    claim: "Disputes are subject to binding arbitration with a class-action waiver, governed by Maryland law.",
    cite: "Terms of Service §14.1, §14.5, §14.7",
  },
];

interface IssueForPacket {
  issue_number: number;
  issue_type: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  reported_via: string;
  reported_by_name: string | null;
  resolution_note: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
}

/** Complaints / QC issues raised on this job — disclosed in the packet so it
 *  presents the complete record, including how each was resolved. */
async function loadIssuesForPacket(supabase: SB, bookingId: string | null): Promise<IssueForPacket[]> {
  if (!bookingId) return [];
  try {
    const { data } = await supabase
      .from("qc_issues")
      .select("issue_number, issue_type, severity, status, title, description, reported_via, reported_by_name, resolution_note, resolved_by_name, resolved_at, created_at")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true })
      .limit(20);
    return (data || []) as IssueForPacket[];
  } catch {
    return [];
  }
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// Edge functions get ~150s of wall clock. Budget the run and resume next
// pass — deterministic filenames make every upload idempotent.
const RUN_TIME_BUDGET_MS = 95_000;
const RUN_UPLOAD_BUDGET = 70;

async function resolveSecret(supabase: SB, key: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    return ((data?.value as string) || Deno.env.get(key) || "").trim();
  } catch {
    return (Deno.env.get(key) || "").trim();
  }
}

function backoffMinutes(attempts: number): number {
  // 10m, 20m, 40m, 80m … capped at 6h
  return Math.min(10 * 2 ** Math.max(0, attempts - 1), 360);
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
}

function extFromUrl(url: string): string {
  const m = url.split("?")[0].match(/\.(jpe?g|png|webp|gif|heic)$/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

interface DocRow {
  id: string;
  booking_id: string | null;
  job_id: string | null;
  booking_ref: string | null;
  client_name: string | null;
  client_email: string | null;
  service_type: string | null;
  service_date: string | null;
  address: string | null;
  cleaner_names: string | null;
  before_photos: string[];
  after_photos: string[];
  notes: string | null;
  completed_at: string | null;
  mirror_attempts: number;
  drive_folder_id: string | null;
  drive_pdf_id: string | null;
}

interface PaymentRecord {
  rows: Array<[string, string]>;
}

/** Booking + acceptance fields used to render checkout / agreement page images. */
interface PageCaptureData {
  customerName: string;
  customerEmail: string;
  serviceType: string;
  serviceDate: string;
  timeSlot: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  totalCents: number | null;
  depositCents: number | null;
  paymentOption: string | null;
  paymentIntentId: string | null;
  paymentReceivedAt: string | null;
  checkoutSessionId: string | null;
  agreedTerms: boolean;
  agreedDisclaimer: boolean;
  agreedRefund: boolean;
  agreedServiceAgreement: boolean;
  signedBy: string | null;
  acceptedAt: string | null;
  agreementSource: string | null;
  agreementIp: string | null;
  userAgent: string | null;
}

async function loadPageCaptureData(supabase: SB, bookingId: string | null, fallback: {
  clientName: string | null;
  clientEmail: string | null;
  serviceType: string | null;
  serviceDate: string | null;
  address: string | null;
}): Promise<PageCaptureData | null> {
  if (!bookingId) return null;
  try {
    const { data: b } = await supabase
      .from("bookings")
      .select(
        "first_name, last_name, email, service_type, service_date, time_slot, address, city, state, zip_code, total_estimate_cents, final_charge_cents, deposit_cents, payment_option, payment_intent_id, payment_received_at, checkout_session_id",
      )
      .eq("id", bookingId)
      .maybeSingle();
    const { data: agr } = await supabase
      .from("service_agreements")
      .select(
        "agreed_terms, agreed_disclaimer, agreed_refund, agreed_service_agreement, signed_by, accepted_at, source, ip, user_agent, created_at",
      )
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nameFromBooking = b
      ? `${b.first_name || ""} ${b.last_name || ""}`.trim()
      : "";
    return {
      customerName: nameFromBooking || fallback.clientName || "Customer",
      customerEmail: String(b?.email || fallback.clientEmail || ""),
      serviceType: String(b?.service_type || fallback.serviceType || "Cleaning"),
      serviceDate: String(b?.service_date || fallback.serviceDate || ""),
      timeSlot: String(b?.time_slot || ""),
      address: String(b?.address || fallback.address || ""),
      city: String(b?.city || ""),
      state: String(b?.state || ""),
      zip: String(b?.zip_code || ""),
      totalCents: b?.final_charge_cents != null
        ? Number(b.final_charge_cents)
        : b?.total_estimate_cents != null
        ? Number(b.total_estimate_cents)
        : null,
      depositCents: b?.deposit_cents != null ? Number(b.deposit_cents) : null,
      paymentOption: b?.payment_option ? String(b.payment_option) : null,
      paymentIntentId: b?.payment_intent_id ? String(b.payment_intent_id) : null,
      paymentReceivedAt: b?.payment_received_at ? String(b.payment_received_at) : null,
      checkoutSessionId: b?.checkout_session_id ? String(b.checkout_session_id) : null,
      agreedTerms: Boolean(agr?.agreed_terms ?? true),
      agreedDisclaimer: Boolean(agr?.agreed_disclaimer ?? true),
      agreedRefund: Boolean(agr?.agreed_refund ?? true),
      agreedServiceAgreement: Boolean(agr?.agreed_service_agreement ?? true),
      signedBy: agr?.signed_by ? String(agr.signed_by) : (nameFromBooking || fallback.clientName || null),
      acceptedAt: agr?.accepted_at
        ? String(agr.accepted_at)
        : agr?.created_at
        ? String(agr.created_at)
        : b?.payment_received_at
        ? String(b.payment_received_at)
        : null,
      agreementSource: agr?.source ? String(agr.source) : "checkout",
      agreementIp: agr?.ip ? String(agr.ip) : null,
      userAgent: agr?.user_agent ? String(agr.user_agent) : null,
    };
  } catch {
    return null;
  }
}

function moneyLabel(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(Number(cents))) return "—";
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

/** A real browser screenshot of a funnel page, captured as the customer used it. */
interface RealPageCapture {
  kind: "checkout" | "agreement";
  bytes: Uint8Array;
  capturedAt: string;
  pageUrl: string | null;
  userAgent: string | null;
  viewport: string | null;
}

/**
 * The newest genuine screenshot per page kind. These are actual captures of
 * what the customer saw (page-captures bucket), so they outrank the
 * reconstructed pages the packet falls back to for older bookings.
 */
async function loadRealPageCaptures(supabase: SB, bookingId: string | null): Promise<RealPageCapture[]> {
  if (!bookingId) return [];
  const out: RealPageCapture[] = [];
  try {
    const { data: rows } = await supabase
      .from("page_captures")
      .select("kind, storage_path, page_url, user_agent, viewport_width, viewport_height, captured_at")
      .eq("booking_id", bookingId)
      .order("captured_at", { ascending: false });
    const seen = new Set<string>();
    for (const row of rows || []) {
      const kind = String(row.kind);
      if (kind !== "checkout" && kind !== "agreement") continue;
      if (seen.has(kind)) continue;
      const { data: file, error } = await supabase.storage
        .from("page-captures")
        .download(String(row.storage_path));
      if (error || !file) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length === 0) continue;
      seen.add(kind);
      out.push({
        kind,
        bytes,
        capturedAt: String(row.captured_at || ""),
        pageUrl: row.page_url ? String(row.page_url) : null,
        userAgent: row.user_agent ? String(row.user_agent) : null,
        viewport: row.viewport_width && row.viewport_height
          ? `${row.viewport_width}×${row.viewport_height}`
          : null,
      });
    }
  } catch (e) {
    log("page capture load failed (non-blocking)", { error: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

/** Live payment record for the dispute packet — booking financials + charges. */
async function loadPaymentRecord(supabase: SB, bookingId: string): Promise<PaymentRecord> {
  const rows: Array<[string, string]> = [];
  try {
    const { data: b } = await supabase
      .from("bookings")
      .select("total_estimate_cents, final_charge_cents, deposit_cents, payment_option, payment_method, payment_received_at, payment_intent_id, hosted_invoice_url, applied_credit_cents, tip_cents")
      .eq("id", bookingId)
      .maybeSingle();
    if (b) {
      const money = (c: number | null | undefined) => c != null ? `$${(Number(c) / 100).toFixed(2)}` : "—";
      rows.push(["Total price", money(b.final_charge_cents ?? b.total_estimate_cents)]);
      if (b.deposit_cents) rows.push(["Deposit", money(b.deposit_cents)]);
      if (b.applied_credit_cents) rows.push(["Credit applied", money(b.applied_credit_cents)]);
      if (b.tip_cents) rows.push(["Tip", money(b.tip_cents)]);
      rows.push(["Payment option", String(b.payment_option || "—")]);
      if (b.payment_method) rows.push(["Payment method", String(b.payment_method)]);
      if (b.payment_received_at) rows.push(["Payment received", new Date(b.payment_received_at).toUTCString()]);
      if (b.payment_intent_id) rows.push(["Stripe payment intent", String(b.payment_intent_id)]);
      if (b.hosted_invoice_url) rows.push(["Invoice / pay link", String(b.hosted_invoice_url)]);
    }
    const { data: addons } = await supabase
      .from("booking_addon_charges")
      .select("added_addons, amount_cents, status, stripe_payment_intent_id, created_at")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true });
    for (const a of addons || []) {
      const labels = Array.isArray(a.added_addons) ? a.added_addons.join(", ") : "add-ons";
      rows.push([
        `Add-on charge (${String(a.status)})`,
        `${labels} — $${(Number(a.amount_cents) / 100).toFixed(2)}${a.stripe_payment_intent_id ? ` · ${a.stripe_payment_intent_id}` : ""}`,
      ]);
    }
  } catch { /* best-effort */ }
  return { rows };
}

/**
 * Resolve a DocuSeal submission's signed-document URL, calling the DocuSeal
 * API when the webhook never stamped document_url, and backfilling the row so
 * the next lookup is free. Returns null when unresolvable.
 */
async function resolveDocusealDocUrl(supabase: SB, sub: { id: string; submission_id: string | null; document_url: string | null }): Promise<string | null> {
  if (sub.document_url) return sub.document_url;
  if (!sub.submission_id) return null;
  try {
    const token = await resolveSecret(supabase, "DOCUSEAL_API_TOKEN");
    if (!token) return null;
    const baseUrl = ((await resolveSecret(supabase, "DOCUSEAL_BASE_URL")) || "https://api.docuseal.com").replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/submissions/${encodeURIComponent(sub.submission_id)}`, {
      headers: { "X-Auth-Token": token },
    });
    if (!res.ok) return null;
    const s = await res.json();
    const docs = (s?.documents || s?.submission?.documents || []) as Array<{ url?: string }>;
    const url = docs[0]?.url || s?.audit_log_url || null;
    if (url) {
      await supabase.from("docuseal_submissions").update({ document_url: url }).eq("id", sub.id)
        .then(() => undefined, () => undefined);
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * The REAL executed agreement for the booking, in priority order:
 *   1. DocuSeal completed submission — the signed document with every mapped
 *      field (service date, client, address, fees) + signatures. This is the
 *      legally-operative copy.
 *   2. service-agreements bucket PDF (browser-generated acceptance) — fallback
 *      only, for bookings that predate DocuSeal.
 */
async function loadAgreementPdf(supabase: SB, bookingId: string, email: string | null): Promise<{ bytes: Uint8Array; signedAt: string; source: "docuseal" | "bucket" } | null> {
  // 1) DocuSeal executed document.
  try {
    const { data: subs } = await supabase
      .from("docuseal_submissions")
      .select("id, submission_id, document_url, audience, status, created_at, completed_at")
      .or(`booking_id.eq.${bookingId}${email ? `,submitter_email.ilike.${email}` : ""}`)
      .in("audience", ["one_time", "membership", "str_host"])
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(3);
    for (const sub of subs || []) {
      const url = await resolveDocusealDocUrl(supabase, sub);
      if (!url) continue;
      const pdfRes = await fetch(url);
      if (!pdfRes.ok) continue;
      const bytes = new Uint8Array(await pdfRes.arrayBuffer());
      if (bytes.length === 0) continue;
      return {
        bytes,
        signedAt: String(sub.completed_at || sub.created_at).slice(0, 10),
        source: "docuseal",
      };
    }
  } catch { /* fall through to bucket */ }

  // 2) Bucket fallback.
  try {
    let { data: agr } = await supabase
      .from("service_agreements")
      .select("id, pdf_path, created_at")
      .eq("booking_id", bookingId)
      .not("pdf_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!agr && email) {
      const res = await supabase
        .from("service_agreements")
        .select("id, pdf_path, created_at")
        .ilike("customer_email", email)
        .not("pdf_path", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      agr = res.data;
    }
    if (!agr?.pdf_path) return null;
    const { data: blob, error } = await supabase.storage.from("service-agreements").download(agr.pdf_path);
    if (error || !blob) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), signedAt: String(agr.created_at).slice(0, 10), source: "bucket" };
  } catch {
    return null;
  }
}

// ─── Snapshot enrichment (checklist + cleaners) ──────────────────────────────

async function enrichSnapshot(supabase: SB, doc: DocRow): Promise<{
  checklist: { name?: string; progress_pct?: number; completed_items?: number; total_items?: number; completed_at?: string | null; items?: unknown } | null;
  cleanerNames: string;
  agreementRef: string | null;
}> {
  let checklist = null;
  let cleanerNames = doc.cleaner_names || "";
  let agreementRef: string | null = null;

  if (doc.job_id) {
    const { data: cl } = await supabase
      .from("job_checklists")
      .select("service_type, items, total_items, completed_items, progress_pct, completed_at")
      .eq("job_id", doc.job_id)
      .maybeSingle();
    if (cl) {
      checklist = {
        name: `${String(cl.service_type || "standard")} checklist`,
        progress_pct: Number(cl.progress_pct) || 0,
        completed_items: Number(cl.completed_items) || 0,
        total_items: Number(cl.total_items) || 0,
        completed_at: cl.completed_at || null,
        items: cl.items || {},
      };
    }
    if (!cleanerNames) {
      const { data: assigns } = await supabase
        .from("job_assignments")
        .select("status, cleaners(first_name, last_name)")
        .eq("job_id", doc.job_id);
      const names = (assigns || [])
        .filter((a: { status?: string }) => ["confirmed", "accepted", "completed", "in progress"].includes(String(a.status || "").toLowerCase()))
        .map((a: { cleaners?: unknown }) => {
          const c = Array.isArray(a.cleaners) ? a.cleaners[0] : a.cleaners;
          return c ? `${(c as { first_name?: string }).first_name || ""} ${(c as { last_name?: string }).last_name || ""}`.trim() : "";
        })
        .filter(Boolean);
      cleanerNames = [...new Set(names)].join(", ");
    }
  }

  try {
    if (!doc.booking_id) throw new Error("no booking");
    const { data: agr } = await supabase
      .from("service_agreements")
      .select("id, created_at")
      .eq("booking_id", doc.booking_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (agr?.id) agreementRef = `Agreement ${String(agr.id).slice(0, 8)} · signed ${String(agr.created_at).slice(0, 10)}`;
  } catch { /* table may not have rows */ }

  return { checklist, cleanerNames, agreementRef };
}

// ─── Completion summary PDF ──────────────────────────────────────────────────

async function buildSummaryPdf(doc: DocRow, extras: {
  checklist: { name?: string; progress_pct?: number; completed_items?: number; total_items?: number } | null;
  cleanerNames: string;
  agreementRef: string | null;
  payment?: PaymentRecord;
  agreementBytes?: Uint8Array | null;
  issues?: IssueForPacket[];
  photos: Array<{ label: string; bytes: Uint8Array }>;
  pageCapture?: PageCaptureData | null;
  realCaptures?: RealPageCapture[];
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const violet = rgb(0.33, 0, 1);
  const gray = rgb(0.32, 0.36, 0.42);
  const dark = rgb(0.07, 0.09, 0.15);

  const PAGE_W = 612, PAGE_H = 792, MARGIN = 54;
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const line = (text: string, opts: { size?: number; font?: typeof font; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = opts.size ?? 11;
    if (y < MARGIN + size) { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
    page.drawText(text.slice(0, 110), { x: MARGIN, y, size, font: opts.font ?? font, color: opts.color ?? dark });
    y -= size + (opts.gap ?? 6);
  };

  /**
   * Embed a REAL screenshot of a funnel page, scaled to fit one packet page,
   * with the capture provenance printed underneath.
   */
  const drawRealCapture = async (cap: RealPageCapture, title: string): Promise<boolean> => {
    try {
      const isPng = cap.bytes[0] === 0x89 && cap.bytes[1] === 0x50;
      const img = isPng ? await pdf.embedPng(cap.bytes) : await pdf.embedJpg(cap.bytes);
      const p = pdf.addPage([PAGE_W, PAGE_H]);
      p.drawText(title, { x: MARGIN, y: PAGE_H - 36, size: 12, font: bold, color: violet });
      p.drawText("Actual screenshot captured in the customer's browser at the moment they completed this step.", {
        x: MARGIN, y: PAGE_H - 51, size: 8, font, color: gray,
      });

      const topY = PAGE_H - 62;
      const bottomY = 66;
      const maxW = PAGE_W - MARGIN * 2;
      const maxH = topY - bottomY;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (PAGE_W - w) / 2;
      p.drawRectangle({
        x: x - 2, y: topY - h - 2, width: w + 4, height: h + 4,
        borderColor: rgb(0.75, 0.78, 0.82), borderWidth: 1,
      });
      p.drawImage(img, { x, y: topY - h, width: w, height: h });

      let cy = 52;
      const meta = (text: string) => {
        p.drawText(text.slice(0, 118), { x: MARGIN, y: cy, size: 7.5, font, color: gray });
        cy -= 10;
      };
      if (cap.capturedAt) meta(`Captured: ${new Date(cap.capturedAt).toUTCString()}`);
      if (cap.pageUrl) meta(`URL: ${cap.pageUrl}`);
      if (cap.viewport) meta(`Viewport: ${cap.viewport} px`);
      if (cap.userAgent) meta(`Device: ${cap.userAgent}`);
      meta("Card entry fields render inside Stripe's isolated frame and are never captured (PCI).");
      return true;
    } catch (e) {
      log("real capture embed failed", { kind: cap.kind, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };


  line("NOVARA CLEANING", { size: 20, font: bold, color: violet, gap: 2 });
  line("Job Completion & Documentation Summary", { size: 13, color: gray, gap: 16 });

  const rows: Array<[string, string]> = [
    ["Booking", doc.booking_ref || doc.booking_id || doc.id.slice(0, 8)],
    ["Client", `${doc.client_name || "—"}${doc.client_email ? ` <${doc.client_email}>` : ""}`],
    ["Service", `${doc.service_type || "—"} on ${doc.service_date || "—"}`],
    ["Address", doc.address || "—"],
    ["Cleaner(s)", extras.cleanerNames || "—"],
    ["Completed at", doc.completed_at ? new Date(doc.completed_at).toUTCString() : "—"],
    ["Photos", `${doc.before_photos.length} before · ${doc.after_photos.length} after`],
  ];
  if (extras.agreementRef) rows.push(["Signed agreement", extras.agreementRef]);
  if (extras.checklist) {
    rows.push(["Checklist", `${extras.checklist.completed_items ?? 0}/${extras.checklist.total_items ?? 0} items (${extras.checklist.progress_pct ?? 0}%)`]);
  }
  for (const [k, v] of rows) {
    if (y < MARGIN + 12) { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
    page.drawText(`${k}:`, { x: MARGIN, y, size: 11, font: bold, color: gray });
    page.drawText(String(v).slice(0, 90), { x: MARGIN + 110, y, size: 11, font, color: dark });
    y -= 18;
  }

  if (extras.payment && extras.payment.rows.length > 0) {
    y -= 8;
    line("Payment Record", { size: 12, font: bold, color: violet, gap: 8 });
    for (const [k, v] of extras.payment.rows) {
      if (y < MARGIN + 12) { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
      page.drawText(`${k}:`, { x: MARGIN, y, size: 10, font: bold, color: gray });
      page.drawText(String(v).slice(0, 84), { x: MARGIN + 140, y, size: 10, font, color: dark });
      y -= 16;
    }
  }

  if (doc.notes) {
    y -= 8;
    line("Notes", { size: 12, font: bold, color: violet, gap: 8 });
    for (const chunk of doc.notes.split(/\n+/).flatMap((p) => p.match(/.{1,100}(\s|$)/g) || [])) {
      line(chunk.trim(), { size: 10, color: gray, gap: 4 });
    }
  }

  y -= 6;
  line(`Generated ${new Date().toUTCString()} — Novara QC Documentation Hub`, { size: 8, color: gray });

  // Policies the client agreed to — cited BY SECTION with source links so
  // every supported claim maps to the exact clause of the published policy.
  y -= 8;
  line("Policies the Client Agreed To (with section citations)", { size: 12, font: bold, color: violet, gap: 8 });
  for (const ref of POLICY_REFS) {
    const chunks = ref.claim.match(/.{1,98}(\s|$)/g) || [ref.claim];
    chunks.forEach((chunk, idx) => {
      line(`${idx === 0 ? "• " : "   "}${chunk.trim()}`, { size: 9, color: gray, gap: 2.5 });
    });
    line(`   Source: ${ref.cite}`, { size: 8, font: bold, color: violet, gap: 6 });
  }
  y -= 4;
  line("Full policy texts (agreed at booking):", { size: 10, font: bold, color: dark, gap: 5 });
  for (const p of POLICY_URLS) {
    line(`   ${p.label}: ${p.url}`, { size: 9, color: gray, gap: 3 });
  }
  line("   One-Time Service Agreement: executed copy attached at the end of this packet.", { size: 9, color: gray, gap: 3 });

  // Complaint / QC issue record — full disclosure of anything raised on this
  // job and how it was handled (with the 24h reporting rule as context).
  const packIssues = extras.issues || [];
  y -= 8;
  line("Complaint & QC Issue Record for This Job", { size: 12, font: bold, color: violet, gap: 8 });
  if (packIssues.length === 0) {
    line("No complaints or quality issues were reported on this job.", { size: 10, color: gray, gap: 4 });
    line("(Concerns must be reported in writing within 24 hours of completion — Terms of Service §7.1.)", { size: 8, color: gray, gap: 4 });
  } else {
    for (const iss of packIssues) {
      line(`Issue #${iss.issue_number} — ${iss.issue_type.replace(/_/g, " ")} · severity: ${iss.severity} · status: ${iss.status.replace(/_/g, " ")}`, { size: 10, font: bold, color: dark, gap: 3 });
      line(`   Reported ${new Date(iss.created_at).toUTCString()} via ${iss.reported_via.replace(/_/g, " ")}${iss.reported_by_name ? ` by ${iss.reported_by_name}` : ""}`, { size: 8.5, color: gray, gap: 3 });
      const titleChunks = `${iss.title}${iss.description ? ` — ${iss.description}` : ""}`.match(/.{1,98}(\s|$)/g) || [];
      for (const c of titleChunks.slice(0, 6)) line(`   ${c.trim()}`, { size: 9, color: gray, gap: 2.5 });
      if (iss.resolution_note) {
        line(`   RESOLVED${iss.resolved_at ? ` ${new Date(iss.resolved_at).toUTCString()}` : ""}${iss.resolved_by_name ? ` by ${iss.resolved_by_name}` : ""}:`, { size: 8.5, font: bold, color: dark, gap: 2.5 });
        for (const c of (iss.resolution_note.match(/.{1,98}(\s|$)/g) || []).slice(0, 4)) {
          line(`   ${c.trim()}`, { size: 9, color: gray, gap: 2.5 });
        }
      }
      y -= 4;
    }
  }

  // ── Checkout + agreement evidence (real screenshots first) ────────────
  //
  // The genuine browser captures are the evidence. When a booking predates
  // page capture we fall back to a plain acceptance record — stated as
  // record data, never dressed up to look like a screenshot.
  const capture = extras.pageCapture;
  const realCaptures = extras.realCaptures || [];

  const realCheckout = realCaptures.find((c) => c.kind === "checkout");
  const checkoutShown = realCheckout
    ? await drawRealCapture(realCheckout, "Checkout page — actual screenshot")
    : false;
  const realAgreement = realCaptures.find((c) => c.kind === "agreement");
  const agreementShown = realAgreement
    ? await drawRealCapture(realAgreement, "Agreement / signature page — actual screenshot")
    : false;

  if (capture && (!checkoutShown || !agreementShown)) {
    const missing = [!checkoutShown ? "checkout" : null, !agreementShown ? "agreement" : null]
      .filter(Boolean).join(" and ");
    y -= 8;
    line("Checkout & Agreement Acceptance Record", { size: 12, font: bold, color: violet, gap: 6 });
    line(`No stored ${missing} page screenshot for this booking (it predates page capture).`, { size: 8.5, color: gray, gap: 3 });
    line("The following is taken from the booking and acceptance records.", { size: 8.5, color: gray, gap: 8 });

    const acceptedAt = capture.acceptedAt
      ? new Date(capture.acceptedAt).toUTCString()
      : capture.paymentReceivedAt
      ? new Date(capture.paymentReceivedAt).toUTCString()
      : "—";
    const accepted = (ok: boolean) => (ok ? "accepted" : "not recorded");
    const rows: Array<[string, string]> = [
      ["Customer", `${capture.customerName}${capture.customerEmail ? ` <${capture.customerEmail}>` : ""}`],
      ["Service", `${capture.serviceType.replace(/_/g, " ")}${capture.serviceDate ? ` on ${capture.serviceDate}` : ""}`],
      ["Address", [capture.address, capture.city, capture.state, capture.zip].filter(Boolean).join(", ") || "—"],
      ["Total", moneyLabel(capture.totalCents)],
      ["Deposit", moneyLabel(capture.depositCents)],
      ["Payment received", capture.paymentReceivedAt ? new Date(capture.paymentReceivedAt).toUTCString() : "—"],
      ["Stripe payment intent", capture.paymentIntentId || "—"],
      ["Checkout session", capture.checkoutSessionId || "—"],
      ["Terms of Service", accepted(capture.agreedTerms)],
      ["Disclaimer", accepted(capture.agreedDisclaimer)],
      ["Refund Policy", accepted(capture.agreedRefund)],
      ["Service Agreement", accepted(capture.agreedServiceAgreement)],
      ["Signed by", capture.signedBy || "—"],
      ["Signed at", acceptedAt],
      ["Acceptance source", capture.agreementSource || "—"],
      ["IP address", capture.agreementIp || "—"],
    ];
    for (const [k, v] of rows) {
      if (y < MARGIN + 12) { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
      page.drawText(`${k}:`, { x: MARGIN, y, size: 9, font: bold, color: gray });
      page.drawText(String(v).slice(0, 84), { x: MARGIN + 150, y, size: 9, font, color: dark });
      y -= 14;
    }
    if (capture.userAgent) {
      line(`Device: ${capture.userAgent.slice(0, 100)}`, { size: 7.5, color: gray, gap: 3 });
    }
    line("The executed agreement PDF is attached at the end of this packet.", { size: 8.5, color: gray, gap: 3 });
  }

  // Photo pages — 2 per page, labelled, preserving aspect ratio. ALL photos.
  const photos = extras.photos;
  for (let i = 0; i < photos.length; i += 2) {
    const photoPage = pdf.addPage([PAGE_W, PAGE_H]);
    for (let slot = 0; slot < 2; slot++) {
      const p = photos[i + slot];
      if (!p) break;
      try {
        const isPng = p.bytes[0] === 0x89 && p.bytes[1] === 0x50;
        const img = isPng ? await pdf.embedPng(p.bytes) : await pdf.embedJpg(p.bytes);
        const maxW = PAGE_W - MARGIN * 2;
        const maxH = (PAGE_H - MARGIN * 2 - 60) / 2;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        const topY = slot === 0 ? PAGE_H - MARGIN : PAGE_H / 2 - 10;
        photoPage.drawText(p.label, { x: MARGIN, y: topY - 12, size: 10, font: bold, color: violet });
        photoPage.drawImage(img, { x: MARGIN, y: topY - 20 - h, width: w, height: h });
      } catch (e) {
        photoPage.drawText(`${p.label} — could not embed (${e instanceof Error ? e.message : "error"})`, {
          x: MARGIN, y: slot === 0 ? PAGE_H - MARGIN - 12 : PAGE_H / 2 - 22, size: 9, font, color: gray,
        });
      }
    }
  }

  // Append the executed service agreement so the packet is one self-contained
  // file: summary + policies + page captures + ALL photos + the signed agreement.
  if (extras.agreementBytes) {
    try {
      const agrDoc = await PDFDocument.load(extras.agreementBytes as unknown as ArrayBuffer, { ignoreEncryption: true });
      const divider = pdf.addPage([PAGE_W, PAGE_H]);
      divider.drawText("SIGNED SERVICE AGREEMENT", { x: MARGIN, y: PAGE_H / 2 + 10, size: 18, font: bold, color: violet });
      divider.drawText("Executed copy — the following pages are the agreement the client signed.", {
        x: MARGIN, y: PAGE_H / 2 - 14, size: 10, font, color: gray,
      });
      const pages = await pdf.copyPages(agrDoc, agrDoc.getPageIndices());
      for (const pg of pages) pdf.addPage(pg);
    } catch (e) {
      log("agreement merge into packet failed (kept as separate file)", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  return await pdf.save();
}

// ─── Mirror one documentation row (resumable across runs) ────────────────────

interface RunBudget {
  deadline: number;
  uploadsLeft: number;
}
class BudgetExhausted extends Error {
  constructor() { super("run budget exhausted — resuming next pass"); }
}

async function mirrorOne(supabase: SB, token: string, rootFolderId: string, doc: DocRow, budget: RunBudget): Promise<void> {
  const docRef = doc.booking_ref || (doc.booking_id ? doc.booking_id.slice(0, 8) : doc.id.slice(0, 8));
  const before = (Array.isArray(doc.before_photos) ? doc.before_photos : []).map(String).filter(Boolean);
  const after = (Array.isArray(doc.after_photos) ? doc.after_photos : []).map(String).filter(Boolean);

  const extras = await enrichSnapshot(supabase, doc);

  // Folder tree: root / YYYY / "MM - Month" / "NVC-xxxxx — Client — date — service"
  const dateStr = doc.service_date || (doc.completed_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const [yy, mm] = dateStr.split("-");
  const monthName = MONTHS[Math.max(0, Math.min(11, Number(mm) - 1))];
  const yearFolder = await ensureFolder(token, rootFolderId, yy);
  const monthFolder = await ensureFolder(token, yearFolder, `${mm} - ${monthName}`);
  const jobFolderName = safeName(
    `${docRef} — ${doc.client_name || "Client"} — ${dateStr} — ${doc.service_type || "clean"}`,
  );
  const jobFolder = doc.drive_folder_id || await ensureFolder(token, monthFolder, jobFolderName);
  await shareReadableByLink(token, jobFolder);

  // Persist the folder immediately so a mid-run death resumes into the SAME
  // folder next pass instead of creating a duplicate tree.
  if (!doc.drive_folder_id) {
    await supabase.from("job_documentation").update({
      drive_folder_id: jobFolder,
      drive_folder_url: folderUrl(jobFolder),
      updated_at: new Date().toISOString(),
    }).eq("id", doc.id);
  }

  const beforeFolder = await ensureFolder(token, jobFolder, "before");
  const afterFolder = await ensureFolder(token, jobFolder, "after");

  // Upload originals with deterministic names so retries skip existing files.
  const existingBefore = await listChildNames(token, beforeFolder);
  const existingAfter = await listChildNames(token, afterFolder);
  const photoBytes: Array<{ label: string; bytes: Uint8Array }> = [];
  let pdfBytesTotal = 0;
  let uploaded = 0;
  const failures: string[] = [];

  const uploadSet = async (urls: string[], folderId: string, prefix: string, existing: Set<string>) => {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const name = `${prefix}-${String(i + 1).padStart(2, "0")}.${extFromUrl(url)}`;
      const needsUpload = !existing.has(name);
      const needsPdfCopy = pdfBytesTotal < MAX_PDF_PHOTO_BYTES;
      if (!needsUpload && !needsPdfCopy) continue;
      if (needsUpload && (Date.now() > budget.deadline || budget.uploadsLeft <= 0)) {
        throw new BudgetExhausted();
      }
      try {
        const res = await fetch(url);
        if (!res.ok) { failures.push(`${name}: fetch ${res.status}`); continue; }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length === 0) { failures.push(`${name}: empty`); continue; }
        if (needsPdfCopy) {
          photoBytes.push({ label: `${prefix.toUpperCase()} ${i + 1} — ${doc.booking_ref || ""}`, bytes });
          pdfBytesTotal += bytes.length;
        }
        if (needsUpload) {
          const mime = name.endsWith(".png") ? "image/png" : "image/jpeg";
          await uploadFile(token, folderId, name, bytes, mime);
          uploaded++;
          budget.uploadsLeft--;
        }
      } catch (e) {
        if (e instanceof BudgetExhausted) throw e;
        failures.push(`${name}: ${e instanceof Error ? e.message : "error"}`);
      }
    }
  };
  await uploadSet(before, beforeFolder, "before", existingBefore);
  await uploadSet(after, afterFolder, "after", existingAfter);

  // Any photo that failed to land in Drive = mirror not complete. Retry later.
  if (failures.length > 0) {
    throw new Error(`photo mirror incomplete (${failures.length}): ${failures.slice(0, 3).join("; ")}`);
  }

  // Executed service agreement (DocuSeal signed doc with mapped fields first,
  // bucket copy as fallback) — uploaded standalone AND merged into the packet.
  const jobFiles = await listChildNames(token, jobFolder);
  let agreement: { bytes: Uint8Array; signedAt: string; source: "docuseal" | "bucket" } | null = null;
  try {
    agreement = doc.booking_id ? await loadAgreementPdf(supabase, doc.booking_id, doc.client_email) : null;
    if (agreement) {
      const agrName = agreement.source === "docuseal"
        ? `${safeName(docRef)} — Executed Agreement (DocuSeal, ${agreement.signedAt}).pdf`
        : `${safeName(docRef)} — Signed Agreement (${agreement.signedAt}).pdf`;
      if (!jobFiles.has(agrName)) {
        await uploadFile(token, jobFolder, agrName, agreement.bytes, "application/pdf");
      }
    }
  } catch (e) {
    log("agreement copy failed (non-blocking)", { docId: doc.id, error: e instanceof Error ? e.message : String(e) });
  }

  // Dispute packet: summary + policy highlights + checkout/agreement page
  // images + ALL photos + the signed agreement, regenerated on every mirror.
  const payment = doc.booking_id ? await loadPaymentRecord(supabase, doc.booking_id) : { rows: [] };
  const packetIssues = await loadIssuesForPacket(supabase, doc.booking_id);
  const pageCapture = await loadPageCaptureData(supabase, doc.booking_id, {
    clientName: doc.client_name,
    clientEmail: doc.client_email,
    serviceType: doc.service_type,
    serviceDate: doc.service_date,
    address: doc.address,
  });

  // Real screenshots of the checkout + agreement pages, mirrored standalone
  // into the job folder as well as embedded in the packet.
  const realCaptures = await loadRealPageCaptures(supabase, doc.booking_id);
  for (const cap of realCaptures) {
    const capName = `${safeName(docRef)} — ${cap.kind === "checkout" ? "Checkout Page" : "Agreement Page"} Screenshot.jpg`;
    if (!jobFiles.has(capName)) {
      try {
        await uploadFile(token, jobFolder, capName, cap.bytes, "image/jpeg");
      } catch (e) {
        log("page capture upload failed (non-blocking)", { kind: cap.kind, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  const pdfBytes = await buildSummaryPdf(doc, {
    ...extras,
    payment,
    agreementBytes: agreement?.bytes || null,
    issues: packetIssues,
    photos: photoBytes,
    pageCapture,
    realCaptures,
  });
  const pdfName = `${safeName(docRef)} — Completion Summary.pdf`;
  let pdfId = doc.drive_pdf_id;
  if (pdfId) {
    try {
      await updateFile(token, pdfId, pdfBytes, "application/pdf");
    } catch {
      pdfId = await uploadFile(token, jobFolder, pdfName, pdfBytes, "application/pdf");
    }
  } else {
    pdfId = await uploadFile(token, jobFolder, pdfName, pdfBytes, "application/pdf");
  }

  const nowIso = new Date().toISOString();
  await supabase.from("job_documentation").update({
    mirror_status: "mirrored",
    mirrored_at: nowIso,
    mirror_last_error: null,
    mirror_next_attempt_at: null,
    drive_folder_id: jobFolder,
    drive_folder_url: folderUrl(jobFolder),
    drive_pdf_id: pdfId,
    drive_pdf_url: pdfId ? fileUrl(pdfId) : null,
    drive_file_count: before.length + after.length + 1,
    checklist_snapshot: extras.checklist,
    checklist_progress_pct: extras.checklist?.progress_pct ?? null,
    cleaner_names: extras.cleanerNames || doc.cleaner_names,
    photo_count: before.length + after.length,
    documented: before.length > 0 && after.length > 0,
    updated_at: nowIso,
  }).eq("id", doc.id);

  log("mirrored", { docId: doc.id, ref: doc.booking_ref, uploaded, folder: jobFolder });
}

// ─── Airtable push (Drive link + documented ✓) ───────────────────────────────

async function pushAirtable(supabase: SB, bookingId: string): Promise<void> {
  try {
    const syncUrl = await resolveSecret(supabase, "AIRTABLE_SYNC_URL");
    const secret = await resolveSecret(supabase, "AIRTABLE_SYNC_WEBHOOK_SECRET");
    if (!syncUrl || !secret) return;
    await fetch(syncUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-airtable-sync-secret": secret },
      body: JSON.stringify({ type: "job", id: bookingId }),
    });
  } catch (e) {
    log("airtable push failed (non-blocking)", { bookingId, error: e instanceof Error ? e.message : String(e) });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const onlyDocId = body?.docId ? String(body.docId) : null;

    if (!driveConfigured()) {
      log("skipped — Google service account not configured");
      return json({ ok: true, skipped: "drive_not_configured" });
    }
    const rootFolderId = await resolveSecret(supabase, "GDRIVE_QC_ROOT_FOLDER_ID");
    if (!rootFolderId) {
      log("skipped — GDRIVE_QC_ROOT_FOLDER_ID not set");
      return json({ ok: true, skipped: "root_folder_not_configured" });
    }

    const nowIso = new Date().toISOString();

    // Recover rows stuck in 'mirroring' (a run that hit the wall-clock limit
    // leaves its claim behind — uploads dedupe by filename, so resuming from
    // 'pending' converges across runs instead of stalling forever).
    await supabase
      .from("job_documentation")
      .update({ mirror_status: "pending", updated_at: nowIso })
      .eq("mirror_status", "mirroring")
      .lt("updated_at", new Date(Date.now() - 5 * 60_000).toISOString());

    let query = supabase
      .from("job_documentation")
      .select("id, booking_id, job_id, booking_ref, client_name, client_email, service_type, service_date, address, cleaner_names, before_photos, after_photos, notes, completed_at, mirror_attempts, drive_folder_id, drive_pdf_id")
      .lt("mirror_attempts", MAX_ATTEMPTS)
      .order("completed_at", { ascending: true })
      .limit(BATCH_SIZE);
    if (onlyDocId) {
      query = query.eq("id", onlyDocId).in("mirror_status", ["pending", "failed", "mirrored"]);
    } else {
      query = query.or(`mirror_status.eq.pending,and(mirror_status.eq.failed,mirror_next_attempt_at.lte.${nowIso})`);
    }
    const { data: docs, error } = await query;
    if (error) throw error;
    if (!docs || docs.length === 0) return json({ ok: true, processed: 0 });

    // Optional domain-wide delegation: when the archive folder is in a user's
    // My Drive (not a Shared Drive), uploads must be owned by a real user —
    // set GOOGLE_DRIVE_IMPERSONATE_EMAIL in app_secrets to that user.
    const impersonate = await resolveSecret(supabase, "GOOGLE_DRIVE_IMPERSONATE_EMAIL");
    const token = await getDriveToken(impersonate || undefined);
    if (!token) {
      log("drive token failed — leaving queue untouched");
      return json({ ok: false, error: "drive_token_failed" }, 200);
    }

    const budget: RunBudget = {
      deadline: Date.now() + RUN_TIME_BUDGET_MS,
      uploadsLeft: RUN_UPLOAD_BUDGET,
    };

    let mirrored = 0, failed = 0, resumed = 0;
    for (const doc of docs as DocRow[]) {
      if (Date.now() > budget.deadline || budget.uploadsLeft <= 0) break;

      // Claim the row so overlapping runs don't double-process.
      const { data: claimed } = await supabase
        .from("job_documentation")
        .update({ mirror_status: "mirroring", updated_at: nowIso })
        .eq("id", doc.id)
        .neq("mirror_status", "mirroring")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      try {
        await mirrorOne(supabase, token, rootFolderId, doc, budget);
        if (doc.booking_id) await pushAirtable(supabase, doc.booking_id);
        mirrored++;
      } catch (e) {
        // Budget exhaustion is NOT a failure — release the claim back to
        // pending (attempts unchanged) and let the next pass resume.
        if (e instanceof BudgetExhausted) {
          await supabase.from("job_documentation").update({
            mirror_status: "pending",
            mirror_next_attempt_at: null,
            updated_at: new Date().toISOString(),
          }).eq("id", doc.id);
          resumed++;
          log("budget hit — will resume", { docId: doc.id, ref: doc.booking_ref });
          break;
        }
        const msg = e instanceof Error ? e.message : String(e);
        const attempts = (doc.mirror_attempts || 0) + 1;
        const next = new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString();
        await supabase.from("job_documentation").update({
          mirror_status: "failed",
          mirror_attempts: attempts,
          mirror_last_error: msg.slice(0, 500),
          mirror_next_attempt_at: next,
          updated_at: new Date().toISOString(),
        }).eq("id", doc.id);
        failed++;
        log("mirror failed", { docId: doc.id, ref: doc.booking_ref, attempts, error: msg });

        // Loud alert once retries are exhausted — an unmirrored job is an
        // undefendable one and its photos will NOT be purged.
        if (attempts >= MAX_ATTEMPTS) {
          await supabase.from("events").insert({
            event_type: "qc.documentation.failed",
            booking_id: doc.booking_id,
            job_id: doc.job_id,
            source: "qc-drive-mirror",
            summary: `${doc.booking_ref || doc.booking_id} — Google Drive mirror FAILED after ${attempts} attempts. Photos remain in Supabase (retention paused) — fix Drive access and retry from the QC console. Last error: ${msg.slice(0, 200)}`,
            data: { documentation_id: doc.id, attempts, error: msg.slice(0, 300) },
          }).then(() => undefined, () => undefined);
        }
      }
    }

    return json({ ok: true, processed: docs.length, mirrored, failed, resumed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
