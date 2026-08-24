// ─── /api/admin/coi ────────────────────────────────────────────────────────
//
// The certificate-of-insurance console's back end.
//
//   GET  ?view=list             every commercial account's computed COI state,
//                               worst first
//        ?accountId=…           one account: document history, override log,
//                               held recurring visits, signed document links
//        ?view=overrides        the override report — who suspended the block,
//                               why, and how often on the same account
//
//   POST { action: … }
//     upload_document   record a newly received certificate (the file itself is
//                       uploaded to the private coi-documents bucket from the
//                       browser first). A readable future expiry supersedes the
//                       prior certificate and lifts the block in the same
//                       transaction. No expiry -> parked for review, block stays.
//     review_document   accept or reject a parked certificate.
//     request_renewal   draft/send the renewal ask to the account's contact.
//     create_override   time-limited exception, reason required.
//     revoke_override   end one early — logged, because ending an exception is
//                       as much a decision as granting it.
//     release_holds     retry recurring visits held while the account was blocked.
//
// Status is never in this API's gift: it is computed from the expiration date
// by the database on every read. Uploading a certificate changes a date; the
// status follows. There is deliberately no "mark as current" action.
//
// Admin/VA only.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "coi-documents";
const DOC_COLS =
  "id, business_account_id, document_path, document_name, document_size_bytes, " +
  "effective_date, expiration_date, carrier, policy_number, coverage_notes, " +
  "lifecycle, review_note, verified_by_name, verified_at, uploaded_by_name, created_at";
const OVERRIDE_COLS =
  "id, business_account_id, reason, expires_at, created_by_name, created_at, " +
  "revoked_at, revoked_by_name, revoked_reason, coi_status_at_grant, coi_expires_at_grant";

async function guard(req: Request) {
  try {
    return { principal: await requireAdmin(req), failure: null as NextResponse | null };
  } catch (e) {
    const err = e as AdminAuthError;
    return {
      principal: null,
      failure: NextResponse.json({ error: err.message }, { status: err.status || 401 }),
    };
  }
}

const s = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max) || null;

/** YYYY-MM-DD or null. A half-typed date is not a date. */
function isoDate(v: unknown): string | null {
  const raw = String(v ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return Number.isFinite(Date.parse(`${raw}T00:00:00Z`)) ? raw : null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const supabase = getAdminSupabase();
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  const view = url.searchParams.get("view") || (accountId ? "account" : "list");

  if (view === "list") {
    // priority_rank puts expired first: those are accounts with live revenue
    // that currently cannot be serviced, which outranks every other gap.
    const { data, error } = await supabase
      .from("commercial_coi_status_v1")
      .select("*")
      .order("priority_rank", { ascending: true })
      .order("days_remaining", { ascending: true, nullsFirst: true })
      .limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, accounts: data || [] });
  }

  if (view === "overrides") {
    const { data, error } = await supabase
      .from("commercial_coi_overrides")
      .select(`${OVERRIDE_COLS}, business_accounts(business_name)`)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Repeated exceptions on one account is the pattern worth seeing: an
    // override is meant to bridge a gap, not to become the arrangement.
    const byAccount = new Map<string, { name: string; total: number; active: number }>();
    for (const row of (data || []) as Array<Record<string, any>>) {
      const key = String(row.business_account_id);
      const entry = byAccount.get(key) ||
        { name: row.business_accounts?.business_name || "Account", total: 0, active: 0 };
      entry.total += 1;
      if (!row.revoked_at && Date.parse(row.expires_at) > Date.now()) entry.active += 1;
      byAccount.set(key, entry);
    }
    const repeated = [...byAccount.entries()]
      .filter(([, v]) => v.total > 1)
      .map(([id, v]) => ({ accountId: id, ...v }))
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({ ok: true, overrides: data || [], repeated });
  }

  if (!accountId) return NextResponse.json({ error: "accountId is required." }, { status: 400 });

  const [statusRes, docsRes, overridesRes, holdsRes] = await Promise.all([
    supabase.from("commercial_coi_status_v1").select("*").eq("account_id", accountId).maybeSingle(),
    supabase.from("commercial_coi_documents").select(DOC_COLS)
      .eq("business_account_id", accountId).order("created_at", { ascending: false }),
    supabase.from("commercial_coi_overrides").select(OVERRIDE_COLS)
      .eq("business_account_id", accountId).order("created_at", { ascending: false }),
    supabase.from("partner_recurring_holds")
      .select("id, service_date, reason, blockers, status, released_at, resolution_note")
      .eq("business_account_id", accountId).order("service_date", { ascending: true }).limit(100),
  ]);

  // Certificates live in a private bucket; hand back short-lived links rather
  // than paths the browser can't use.
  const documents = await Promise.all(
    ((docsRes.data || []) as Array<Record<string, any>>).map(async (doc) => {
      let signedUrl: string | null = null;
      if (doc.document_path) {
        const { data: signed } = await supabase.storage
          .from(BUCKET).createSignedUrl(String(doc.document_path), 3600);
        signedUrl = signed?.signedUrl || null;
      }
      return { ...doc, signedUrl };
    }),
  );

  return NextResponse.json({
    ok: true,
    status: statusRes.data || null,
    documents,
    overrides: overridesRes.data || [],
    holds: holdsRes.data || [],
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure) return failure;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const action = String(body.action || "");
  const accountId = String(body.accountId || "").trim();
  if (!accountId) return NextResponse.json({ error: "accountId is required." }, { status: 400 });

  const { data: account } = await supabase
    .from("business_accounts")
    .select("id, business_name, email, contact_name, phone, assigned_va_email")
    .eq("id", accountId).maybeSingle();
  if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const actorName = s(body.actorName, 120) || principal?.email || "Admin";

  const statusOf = async () => {
    const { data } = await supabase.rpc("commercial_coi_status", { p_account_id: accountId });
    return (data || {}) as Record<string, any>;
  };

  // ── Record a newly received certificate ────────────────────────────────
  if (action === "upload_document") {
    const expiration = isoDate(body.expirationDate);
    const effective = isoDate(body.effectiveDate);
    if (effective && expiration && expiration < effective) {
      return NextResponse.json(
        { error: "The expiration date is before the effective date — check the certificate." },
        { status: 400 },
      );
    }

    // No readable expiry means no computable status, which means it cannot
    // count as cover. It is parked for review rather than quietly accepted:
    // guessing here would put a crew on site behind a certificate nobody read.
    const needsReview = !expiration;
    const before = await statusOf();

    // Superseding and recording are two statements, and only one certificate
    // may be in force at a time. If the second fails after the first
    // succeeded, the account would be left with no cover at all — blocked by a
    // failed upload, which is a worse outcome than the upload simply not
    // working. Remember what was displaced so it can be put back.
    let displacedId: string | null = null;
    if (!needsReview) {
      const { data: prior } = await supabase
        .from("commercial_coi_documents")
        .select("id")
        .eq("business_account_id", accountId)
        .eq("lifecycle", "current")
        .maybeSingle();
      displacedId = (prior as { id?: string } | null)?.id ?? null;

      // The prior certificate is superseded, never overwritten — "were we
      // covered on the day of that job" is a question asked after the fact.
      const { error: supersedeErr } = await supabase
        .from("commercial_coi_documents")
        .update({ lifecycle: "superseded", updated_at: new Date().toISOString() })
        .eq("business_account_id", accountId)
        .eq("lifecycle", "current");
      if (supersedeErr) {
        return NextResponse.json({ error: supersedeErr.message }, { status: 400 });
      }
    }

    const { data: doc, error } = await supabase
      .from("commercial_coi_documents")
      .insert({
        business_account_id: accountId,
        document_path: s(body.documentPath, 500),
        document_name: s(body.documentName, 200),
        document_size_bytes: Number(body.documentSizeBytes) || null,
        effective_date: effective,
        expiration_date: expiration,
        carrier: s(body.carrier, 160),
        policy_number: s(body.policyNumber, 120),
        coverage_notes: s(body.coverageNotes, 2000),
        lifecycle: needsReview ? "needs_review" : "current",
        review_note: needsReview
          ? "Uploaded without a readable expiration date — confirm the date before this counts as cover."
          : s(body.reviewNote, 1000),
        verified_by: needsReview ? null : principal?.userId ?? null,
        verified_by_name: needsReview ? null : actorName,
        verified_at: needsReview ? null : new Date().toISOString(),
        uploaded_by: principal?.userId ?? null,
        uploaded_by_name: actorName,
      })
      .select(DOC_COLS)
      .maybeSingle();
    if (error) {
      if (displacedId) {
        await supabase.from("commercial_coi_documents")
          .update({ lifecycle: "current", updated_at: new Date().toISOString() })
          .eq("id", displacedId);
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const savedDoc = (doc || null) as Record<string, any> | null;

    const after = await statusOf();
    const unblocked = before?.blocked === true && after?.blocked === false;

    // A renewal that clears the account should put its held recurring visits
    // back on the calendar without anyone pressing a second button.
    let released = 0;
    if (unblocked) {
      const outcome = await releaseHolds(supabase, accountId);
      released = outcome.released;
    }

    await supabase.from("events").insert({
      event_type: needsReview ? "coi.needs_review" : "coi.renewed",
      source: "admin-coi",
      summary: needsReview
        ? `${account.business_name} — certificate uploaded with no readable expiry date; parked for review, the block stays in place.`
        : `${account.business_name} — certificate renewed through ${expiration} by ${actorName}.` +
          (unblocked
            ? ` Block lifted for all sites${released ? `; ${released} held recurring visit${released === 1 ? "" : "s"} released.` : "."}`
            : ""),
      data: {
        account_id: accountId,
        document_id: savedDoc?.id,
        expiration_date: expiration,
        was_blocked: before?.blocked === true,
        now_blocked: after?.blocked === true,
        holds_released: released,
      },
    });

    return NextResponse.json({
      ok: true,
      document: savedDoc,
      status: after,
      needsReview,
      unblocked,
      holdsReleased: released,
    });
  }

  // ── Accept or reject a parked certificate ──────────────────────────────
  if (action === "review_document") {
    const documentId = String(body.documentId || "").trim();
    const decision = String(body.decision || "");
    if (!documentId) return NextResponse.json({ error: "documentId is required." }, { status: 400 });
    if (!["accept", "reject"].includes(decision)) {
      return NextResponse.json({ error: "decision must be accept or reject." }, { status: 400 });
    }

    if (decision === "reject") {
      const { error } = await supabase.from("commercial_coi_documents").update({
        lifecycle: "rejected",
        review_note: s(body.reviewNote, 1000) || "Rejected on review.",
        verified_by: principal?.userId ?? null,
        verified_by_name: actorName,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", documentId).eq("business_account_id", accountId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, status: await statusOf() });
    }

    const expiration = isoDate(body.expirationDate);
    if (!expiration) {
      return NextResponse.json(
        { error: "Accepting a certificate requires its expiration date — that date is what the status is computed from." },
        { status: 400 },
      );
    }
    const before = await statusOf();
    const { data: prior } = await supabase
      .from("commercial_coi_documents")
      .select("id").eq("business_account_id", accountId).eq("lifecycle", "current").maybeSingle();
    const displacedId = (prior as { id?: string } | null)?.id ?? null;

    await supabase.from("commercial_coi_documents")
      .update({ lifecycle: "superseded", updated_at: new Date().toISOString() })
      .eq("business_account_id", accountId).eq("lifecycle", "current");

    const { error } = await supabase.from("commercial_coi_documents").update({
      lifecycle: "current",
      expiration_date: expiration,
      effective_date: isoDate(body.effectiveDate),
      review_note: s(body.reviewNote, 1000),
      verified_by: principal?.userId ?? null,
      verified_by_name: actorName,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", documentId).eq("business_account_id", accountId);
    if (error) {
      // Same reasoning as upload: a failed promotion must not leave the
      // account with nothing in force.
      if (displacedId) {
        await supabase.from("commercial_coi_documents")
          .update({ lifecycle: "current", updated_at: new Date().toISOString() })
          .eq("id", displacedId);
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const after = await statusOf();
    let released = 0;
    if (before?.blocked === true && after?.blocked === false) {
      released = (await releaseHolds(supabase, accountId)).released;
    }
    return NextResponse.json({ ok: true, status: after, holdsReleased: released });
  }

  // ── Ask the client for the renewal ─────────────────────────────────────
  if (action === "request_renewal") {
    const to = s(body.to, 200) || account.email;
    if (!to) {
      return NextResponse.json(
        { error: "No contact email on this account — add one before requesting a renewal." },
        { status: 400 },
      );
    }
    const subject = s(body.subject, 200) || `Certificate of insurance renewal — ${account.business_name}`;
    const message = s(body.message, 5000);
    if (!message) return NextResponse.json({ error: "The message body is required." }, { status: 400 });

    const { error } = await supabase.functions.invoke("admin-send-email", {
      body: {
        to,
        subject,
        html: message.split("\n").map((l) => `<p>${l}</p>`).join(""),
      },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });

    await supabase.from("events").insert({
      event_type: "coi.renewal_requested",
      source: "admin-coi",
      summary: `${account.business_name} — COI renewal requested from ${to} by ${actorName}.`,
      data: { account_id: accountId, to, subject },
    });

    return NextResponse.json({ ok: true, sentTo: to });
  }

  // ── Time-limited exception to the block ────────────────────────────────
  if (action === "create_override") {
    const reason = s(body.reason, 2000) || "";
    const days = Number(body.days);
    if (reason.length < 10) {
      return NextResponse.json(
        { error: "An override needs a real reason — what is being waited on, and on whose word." },
        { status: 400 },
      );
    }
    const { data: maxSetting } = await supabase.from("app_settings")
      .select("value").eq("key", "coi_lifecycle_settings").maybeSingle();
    const maxDays = Number((maxSetting?.value as Record<string, unknown>)?.max_override_days) || 30;
    if (!Number.isFinite(days) || days <= 0 || days > maxDays) {
      return NextResponse.json(
        { error: `An override has to expire, and within ${maxDays} days — an exception with no end is just a disabled rule.` },
        { status: 400 },
      );
    }

    const current = await statusOf();
    const expiresAt = new Date(Date.now() + days * 86400_000).toISOString();
    const { data: override, error } = await supabase
      .from("commercial_coi_overrides")
      .insert({
        business_account_id: accountId,
        reason,
        expires_at: expiresAt,
        created_by: principal?.userId ?? null,
        created_by_name: actorName,
        coi_status_at_grant: current?.status || null,
        coi_expires_at_grant: current?.expiration_date || null,
      })
      .select(OVERRIDE_COLS)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const savedOverride = (override || null) as Record<string, any> | null;

    const { count: priorCount } = await supabase
      .from("commercial_coi_overrides")
      .select("id", { count: "exact", head: true })
      .eq("business_account_id", accountId);

    await supabase.from("events").insert({
      event_type: "coi.override.created",
      source: "admin-coi",
      summary: `${account.business_name} — COI block overridden for ${days} day${days === 1 ? "" : "s"} by ${actorName}: ${reason}` +
        ((priorCount ?? 0) > 1 ? ` (override #${priorCount} on this account).` : ""),
      data: {
        account_id: accountId,
        override_id: savedOverride?.id,
        days,
        expires_at: expiresAt,
        reason,
        coi_status_at_grant: current?.status,
        override_count: priorCount ?? 1,
      },
    });

    return NextResponse.json({ ok: true, override: savedOverride, status: await statusOf() });
  }

  if (action === "revoke_override") {
    const overrideId = String(body.overrideId || "").trim();
    if (!overrideId) return NextResponse.json({ error: "overrideId is required." }, { status: 400 });
    const { error } = await supabase.from("commercial_coi_overrides").update({
      revoked_at: new Date().toISOString(),
      revoked_by: principal?.userId ?? null,
      revoked_by_name: actorName,
      revoked_reason: s(body.reason, 1000) || "Revoked by admin.",
    }).eq("id", overrideId).eq("business_account_id", accountId).is("revoked_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await supabase.from("events").insert({
      event_type: "coi.override.revoked",
      source: "admin-coi",
      summary: `${account.business_name} — COI override revoked by ${actorName}. The block is back in force.`,
      data: { account_id: accountId, override_id: overrideId },
    });
    return NextResponse.json({ ok: true, status: await statusOf() });
  }

  if (action === "release_holds") {
    const outcome = await releaseHolds(supabase, accountId);
    return NextResponse.json({ ok: true, ...outcome });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

/**
 * Turn this account's held recurring visits into real bookings.
 *
 * Called automatically whenever an upload clears the block, so "the renewal
 * landed" and "the visits are back on the calendar" are one action rather than
 * two, the second of which gets forgotten.
 */
async function releaseHolds(
  supabase: ReturnType<typeof getAdminSupabase>,
  accountId: string,
): Promise<{ released: number; failed: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: holds } = await supabase
    .from("partner_recurring_holds")
    .select("id, schedule_id, service_date")
    .eq("business_account_id", accountId)
    .eq("status", "held")
    .gte("service_date", today)
    .order("service_date", { ascending: true })
    .limit(50);
  if (!holds?.length) return { released: 0, failed: 0 };

  let released = 0, failed = 0;
  for (const hold of holds as Array<Record<string, any>>) {
    const { data: sched } = await supabase
      .from("partner_recurring_schedules").select("*").eq("id", hold.schedule_id).maybeSingle();
    if (!sched || sched.active === false) continue;

    const { data: res, error } = await supabase.functions.invoke("book-partner-job", {
      body: {
        bookingType: sched.booking_type,
        businessAccountId: sched.business_account_id || undefined,
        businessSiteId: sched.business_site_id || undefined,
        propertyId: sched.property_id || undefined,
        serviceDate: String(hold.service_date),
        arrivalWindow: sched.preferred_window || undefined,
        hardDeadline: sched.hard_deadline || undefined,
        accessMethod: sched.access_method || "See access notes",
        accessNotes: sched.access_notes || undefined,
        serviceType: sched.service_type || undefined,
        scopeNotes: sched.scope_notes || "Recurring service — standard scope for this location.",
        specialInstructions: sched.special_instructions || undefined,
        priceCents: Number(sched.price_cents) || 0,
        cleanerPayPct: Number(sched.cleaner_pay_pct) || 35,
        paymentStatus: "invoice",
        cleanerIds: Array.isArray(sched.preferred_cleaner_ids) ? sched.preferred_cleaner_ids : [],
        facilityTypeKey: sched.facility_type_key || undefined,
        scopeLevel: sched.scope_level || undefined,
        squareFootage: sched.sqft || undefined,
        windowHours: sched.service_window_hours || undefined,
        numCleaners: sched.num_cleaners || undefined,
        scheduleId: sched.id,
      },
    });
    if (error || res?.ok === false) { failed++; continue; }

    await supabase.from("partner_recurring_holds").update({
      status: "released",
      released_booking_id: res?.bookingId || null,
      released_at: new Date().toISOString(),
      resolution_note: "Released when the account's certificate was renewed.",
      updated_at: new Date().toISOString(),
    }).eq("id", hold.id);
    await supabase.from("events").insert({
      event_type: "commercial.recurring.released",
      booking_id: res?.bookingId || null,
      source: "admin-coi",
      summary: `Held recurring visit on ${hold.service_date} released and booked (${res?.ref || "booked"}) after the COI renewal.`,
      data: { hold_id: hold.id, account_id: accountId },
    }).then(() => undefined, () => undefined);
    released++;
  }
  return { released, failed };
}
