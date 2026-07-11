// qc-case-file
//
// Live case-management assembly for the QC console. Given a booking, builds
// the FULL legal case file at request time — nothing cached, nothing stale:
//
//   • customer record + booking details (service, address, timestamps)
//   • signed agreements — service_agreements PDFs (fresh signed URLs from the
//     private bucket) + DocuSeal e-sign submissions
//   • payment record — booking financials, LIVE Stripe payment intents &
//     charges (amount, status, receipt URL, refunds) for the main payment,
//     completion hold, and every add-on charge
//   • cleaner-uploaded before/after photos (live booking arrays, falling back
//     to the Drive archive after the 14-day purge)
//   • checklist execution state
//   • documentation / Drive archive status (folder + dispute-packet PDF)
//   • every QC issue on the job with its full audit trail
//   • the booking's event timeline (audit bus)
//
// Auth: admin/VA JWT only.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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
  console.log(`[qc-case-file] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

// Policies the client agreed to at booking — cited by section against the
// live published policies so VAs quote the exact clause when handling
// disputes. Full texts: novaracleaning.com/terms · /refund-policy ·
// /cancellation-policy · /disclaimer.
const POLICY_HIGHLIGHTS: string[] = [
  "Booking = binding acceptance of all policies (ToS §1.2, §1.4).",
  "All sales final once service is rendered (ToS §6.3 · Refund §1.1).",
  "Primary remedy is a complimentary re-clean, not a refund (ToS §7.1, §7.3 · Refund §1.2, §2.1). Declining it waives further refund eligibility (Refund §2.5).",
  "Concerns must be reported IN WRITING within 24h with itemized areas + timestamped photos, property undisturbed (ToS §7.1 · Refund §3.1–3.4).",
  "Subjective dissatisfaction is never refundable (ToS §6.4 · Refund §5.2, §6).",
  "Out-of-scope tasks (fridge/oven/add-ons never booked) are not refundable (Refund §5.7).",
  "24h cancellation notice; same-day cancel/no-show/access failure forfeits 100% (Cancellation §1.1, §2.2–2.3, §10 · ToS §6.1).",
  "72h written dispute resolution is REQUIRED before any chargeback; unauthorized chargebacks = fraud + $150 fee + full liability (ToS §10.1–10.4 · Refund §8.2–8.5).",
  "Client consented to photo/GPS/checklist evidence retention (4 years) usable in disputes (ToS §13.1–13.4 · Disclaimer §8.4).",
  "Liability capped at the amount paid; damage claims within 24h (ToS §11.2–11.3).",
  "Memberships: 14 days' written notice to cancel (ToS §6.2 · Refund §10.1).",
  "Binding arbitration + class-action waiver, Maryland law (ToS §14.1, §14.5, §14.7).",
];

async function resolveSecret(supabase: SB, key: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    return ((data?.value as string) || Deno.env.get(key) || "").trim();
  } catch {
    return (Deno.env.get(key) || "").trim();
  }
}

/**
 * Resolve a DocuSeal submission's signed-document URL live: use the stored
 * document_url when present, otherwise fetch it from the DocuSeal API and
 * backfill the row. Guarantees the case file links the EXECUTED document
 * (mapped fields + signatures), not a template.
 */
async function resolveDocusealDocUrl(admin: SB, sub: { id: string; submission_id: string | null; document_url: string | null }): Promise<string | null> {
  if (sub.document_url) return sub.document_url;
  if (!sub.submission_id) return null;
  try {
    const token = await resolveSecret(admin, "DOCUSEAL_API_TOKEN");
    if (!token) return null;
    const baseUrl = ((await resolveSecret(admin, "DOCUSEAL_BASE_URL")) || "https://api.docuseal.com").replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/submissions/${encodeURIComponent(sub.submission_id)}`, {
      headers: { "X-Auth-Token": token },
    });
    if (!res.ok) return null;
    const s = await res.json();
    const docs = (s?.documents || s?.submission?.documents || []) as Array<{ url?: string }>;
    const url = docs[0]?.url || s?.audit_log_url || null;
    if (url) {
      await admin.from("docuseal_submissions").update({ document_url: url }).eq("id", sub.id)
        .then(() => undefined, () => undefined);
    }
    return url;
  } catch {
    return null;
  }
}

async function ensureAdminOrVa(admin: SB, jwt: string): Promise<void> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
}

// ─── Live Stripe lookups ─────────────────────────────────────────────────────

interface StripePayment {
  kind: string;
  payment_intent_id: string;
  amount_cents: number | null;
  status: string | null;
  description: string | null;
  receipt_url: string | null;
  refunded_cents: number;
  created: string | null;
  error?: string;
}

async function stripePayment(kind: string, piId: string, stripeKey: string): Promise<StripePayment> {
  const base: StripePayment = {
    kind, payment_intent_id: piId, amount_cents: null, status: null,
    description: null, receipt_url: null, refunded_cents: 0, created: null,
  };
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(piId)}?expand[]=latest_charge`,
      { headers: { Authorization: `Bearer ${stripeKey}` } },
    );
    if (!res.ok) return { ...base, error: `stripe ${res.status}` };
    const pi = await res.json();
    const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    return {
      ...base,
      amount_cents: Number(pi.amount) || null,
      status: String(pi.status || ""),
      description: pi.description || null,
      receipt_url: charge?.receipt_url || null,
      refunded_cents: Number(charge?.amount_refunded) || 0,
      created: pi.created ? new Date(pi.created * 1000).toISOString() : null,
    };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "Not signed in." }, 401);
    await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.bookingId || "");
    if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);

    // ── Booking (the case anchor) ─────────────────────────────────────────
    const { data: booking } = await admin
      .from("bookings")
      .select(
        "id, booking_number, status, service_type, service_date, time_slot, arrival_window, created_at, confirmed_at, completed_at, cancelled_at, " +
        "first_name, last_name, email, phone, address, city, state, zip_code, customer_id, job_id, cleaner_id, " +
        "total_estimate_cents, final_charge_cents, deposit_cents, applied_credit_cents, tip_cents, cancel_fee_cents, reschedule_fee_cents, " +
        "payment_option, payment_method, payment_received_at, payment_intent_id, hosted_invoice_url, stripe_invoice_id, checkout_session_id, " +
        "completion_hold_pi_id, completion_hold_status, completion_hold_captured_amount, completion_hold_captured_at, " +
        "add_ons, membership_plan, is_recurring, team_notes, issues_notes, access_notes, check_in_time, check_out_time, " +
        "before_photos, after_photos, photo_upload_submitted_at, num_cleaners_assigned",
      )
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return json({ ok: false, error: "Booking not found." }, 404);

    const bookingRef = booking.booking_number
      ? `NOV-${String(booking.booking_number).padStart(5, "0")}`
      : bookingId.slice(0, 8);

    // ── Parallel live pulls ───────────────────────────────────────────────
    const [
      customerRes, docRes, checklistRes, agreementsRes, docusealRes,
      addonChargesRes, issuesRes, eventsRes, assignsRes,
    ] = await Promise.all([
      booking.customer_id
        ? admin.from("customers").select("id, email, first_name, last_name, phone, address, city, state, zip, membership_status, membership_plan, stripe_customer_id, created_at").eq("id", booking.customer_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from("job_documentation").select("*").eq("booking_id", bookingId).maybeSingle(),
      booking.job_id
        ? admin.from("job_checklists").select("service_type, items, total_items, completed_items, progress_pct, started_at, completed_at, last_activity_by").eq("job_id", booking.job_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from("service_agreements").select("id, customer_email, customer_name, signed_by, source, pdf_path, created_at, agreed_terms, agreed_disclaimer, agreed_refund, agreed_service_agreement")
        .or(`booking_id.eq.${bookingId}${booking.email ? `,customer_email.ilike.${booking.email}` : ""}`)
        .order("created_at", { ascending: false }).limit(5),
      booking.email
        ? admin.from("docuseal_submissions").select("id, submission_id, audience, status, submitter_email, document_url, created_at, completed_at").ilike("submitter_email", booking.email).order("created_at", { ascending: false }).limit(5)
        : Promise.resolve({ data: [] }),
      admin.from("booking_addon_charges").select("id, added_addons, removed_addons, amount_cents, status, stripe_payment_intent_id, hosted_invoice_url, note, created_at").eq("booking_id", bookingId).order("created_at", { ascending: true }),
      admin.from("qc_issues").select("*").eq("booking_id", bookingId).order("created_at", { ascending: false }),
      admin.from("events").select("event_type, occurred_at, source, summary").eq("booking_id", bookingId).order("occurred_at", { ascending: false }).limit(60),
      booking.job_id
        ? admin.from("job_assignments").select("status, cleaner_id, cleaners(first_name, last_name, phone)").eq("job_id", booking.job_id)
        : Promise.resolve({ data: [] }),
    ]);

    // ── DocuSeal: resolve executed-document URLs live (API fallback) ─────
    const docuseal = [] as Array<Record<string, unknown>>;
    for (const d of docusealRes.data || []) {
      const document_url = String(d.status) === "completed" ? await resolveDocusealDocUrl(admin, d) : d.document_url;
      docuseal.push({ ...d, document_url });
    }

    // ── Agreements: mint fresh signed URLs for the private PDFs ──────────
    const agreements = [] as Array<Record<string, unknown>>;
    for (const a of agreementsRes.data || []) {
      let pdfUrl: string | null = null;
      if (a.pdf_path) {
        const { data: signed } = await admin.storage.from("service-agreements").createSignedUrl(a.pdf_path, 3600);
        pdfUrl = signed?.signedUrl || null;
      }
      agreements.push({
        id: a.id, signed_by: a.signed_by || a.customer_name, source: a.source,
        signed_at: a.created_at, pdf_url: pdfUrl,
        agreed: {
          terms: a.agreed_terms, disclaimer: a.agreed_disclaimer,
          refund: a.agreed_refund, service_agreement: a.agreed_service_agreement,
        },
      });
    }

    // ── Payments: live Stripe state for every money movement ─────────────
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
    const piLookups: Array<{ kind: string; id: string }> = [];
    if (booking.payment_intent_id) piLookups.push({ kind: "Booking payment", id: booking.payment_intent_id });
    if (booking.completion_hold_pi_id) piLookups.push({ kind: "Completion hold / balance", id: booking.completion_hold_pi_id });
    for (const c of addonChargesRes.data || []) {
      if (c.stripe_payment_intent_id) {
        const labels = Array.isArray(c.added_addons) ? c.added_addons.join(", ") : "add-ons";
        piLookups.push({ kind: `Add-on charge (${labels})`, id: c.stripe_payment_intent_id });
      }
    }
    const stripePayments = stripeKey
      ? await Promise.all(piLookups.map((p) => stripePayment(p.kind, p.id, stripeKey)))
      : [];

    // ── Cleaners on the job ───────────────────────────────────────────────
    const cleaners = (assignsRes.data || [])
      .filter((a: { status?: string }) => ["confirmed", "accepted", "completed", "in progress"].includes(String(a.status || "").toLowerCase()))
      .map((a: { cleaners?: unknown; status?: string }) => {
        const c = Array.isArray(a.cleaners) ? a.cleaners[0] : a.cleaners;
        return c
          ? { name: `${(c as { first_name?: string }).first_name || ""} ${(c as { last_name?: string }).last_name || ""}`.trim(), status: a.status }
          : null;
      })
      .filter(Boolean);

    // ── Issues + their audit trails ───────────────────────────────────────
    const issues = issuesRes.data || [];
    const issueIds = issues.map((i: { id: string }) => i.id);
    let issueEvents: Array<Record<string, unknown>> = [];
    if (issueIds.length > 0) {
      const { data: evts } = await admin
        .from("qc_issue_events")
        .select("issue_id, action, from_status, to_status, note, actor_name, created_at")
        .in("issue_id", issueIds)
        .order("created_at", { ascending: true });
      issueEvents = evts || [];
    }

    const doc = docRes.data;
    const livePhotos = {
      before: (booking.before_photos || []).filter((u: string) => String(u).startsWith("http")),
      after: (booking.after_photos || []).filter((u: string) => String(u).startsWith("http")),
      purged: Boolean(doc?.photos_purged_at),
      submitted_at: booking.photo_upload_submitted_at,
    };

    return json({
      ok: true,
      case: {
        ref: bookingRef,
        booking: {
          id: booking.id,
          status: booking.status,
          service_type: booking.service_type,
          service_date: booking.service_date,
          time_slot: booking.time_slot || booking.arrival_window,
          address: [booking.address, booking.city, booking.state, booking.zip_code].filter(Boolean).join(", "),
          created_at: booking.created_at,
          confirmed_at: booking.confirmed_at,
          completed_at: booking.completed_at,
          cancelled_at: booking.cancelled_at,
          check_in_time: booking.check_in_time,
          check_out_time: booking.check_out_time,
          add_ons: booking.add_ons || [],
          membership_plan: booking.membership_plan,
          is_recurring: booking.is_recurring,
          team_notes: booking.team_notes,
          issues_notes: booking.issues_notes,
        },
        customer: customerRes.data
          ? { ...customerRes.data }
          : { email: booking.email, first_name: booking.first_name, last_name: booking.last_name, phone: booking.phone },
        cleaners,
        agreements,
        docuseal,
        payments: {
          totals: {
            total_cents: booking.final_charge_cents ?? booking.total_estimate_cents,
            deposit_cents: booking.deposit_cents,
            applied_credit_cents: booking.applied_credit_cents,
            tip_cents: booking.tip_cents,
            cancel_fee_cents: booking.cancel_fee_cents,
            payment_option: booking.payment_option,
            payment_method: booking.payment_method,
            payment_received_at: booking.payment_received_at,
            hosted_invoice_url: booking.hosted_invoice_url,
          },
          stripe: stripePayments,
          addon_charges: addonChargesRes.data || [],
          completion_hold: booking.completion_hold_pi_id
            ? {
              pi_id: booking.completion_hold_pi_id,
              status: booking.completion_hold_status,
              captured_cents: booking.completion_hold_captured_amount,
              captured_at: booking.completion_hold_captured_at,
            }
            : null,
        },
        photos: livePhotos,
        checklist: checklistRes.data || null,
        documentation: doc
          ? {
            id: doc.id,
            documented: doc.documented,
            mirror_status: doc.mirror_status,
            mirror_last_error: doc.mirror_last_error,
            drive_folder_url: doc.drive_folder_url,
            drive_pdf_url: doc.drive_pdf_url,
            photo_count: doc.photo_count,
            photos_purged_at: doc.photos_purged_at,
            mirrored_at: doc.mirrored_at,
          }
          : null,
        issues,
        issue_events: issueEvents,
        timeline: eventsRes.data || [],
        policy_highlights: POLICY_HIGHLIGHTS,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    const status = msg.includes("Not signed in") ? 401 : msg.includes("only") ? 403 : 500;
    return json({ ok: false, error: msg }, status);
  }
});
