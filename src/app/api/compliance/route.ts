import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import {
  DEFAULT_SETTINGS,
  SMS_HELP_REPLY,
  SMS_STOP_REPLY,
  acceptancesForSurface,
  buildAcceptanceRecord,
  disputeAcknowledgments,
  liveDraftAcceptances,
  openDataRequest,
  phoneDigits,
  policySnapshotFrom,
  smsKeyword,
  type AcceptanceKind,
  type AcceptanceRecord,
  type ComplianceSettings,
  type Surface,
} from "@/lib/compliance";
import { getProcessStore } from "@/lib/compliance/store";
import { ADMIN_GAPS, DRAFT_REVIEW_LABEL, PUBLIC_SITE } from "@/lib/public-site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "not recorded";
}

function mapAcceptance(row: Record<string, unknown>): AcceptanceRecord {
  return {
    id: String(row.id),
    kind: row.kind as AcceptanceRecord["kind"],
    action: row.action === "withdrawn" ? "withdrawn" : "accepted",
    wordingVersionId: String(row.wording_version_id || ""),
    wordingVersion: Number(row.wording_version || 1),
    wordingStatus: row.wording_status === "reviewed" ? "reviewed" : "draft",
    wordingShown: String(row.wording_shown || ""),
    acceptedAt: String(row.accepted_at || ""),
    timeZone: String(row.time_zone || "UTC"),
    deviceTimeZone: row.device_time_zone ? String(row.device_time_zone) : null,
    ip: String(row.ip || ""),
    userAgent: String(row.user_agent || ""),
    personName: row.person_name ? String(row.person_name) : null,
    email: row.email ? String(row.email) : null,
    phone: row.phone ? String(row.phone) : null,
    bookingId: row.booking_id ? String(row.booking_id) : null,
    agreementId: row.agreement_id ? String(row.agreement_id) : null,
    chargeId: row.charge_id ? String(row.charge_id) : null,
    relationship: row.relationship ? String(row.relationship) : null,
    propertyLabel: row.property_label ? String(row.property_label) : null,
    amountBasis: row.amount_basis ? String(row.amount_basis) : null,
    surface: String(row.surface || "residential_checkout") as AcceptanceRecord["surface"],
  };
}

async function readAcceptances(filter?: { bookingId?: string; email?: string }): Promise<AcceptanceRecord[] | null> {
  try {
    const { getAdminSupabase } = await import("@/lib/airtable/sources/admin-client");
    let query = getAdminSupabase()
      .from("compliance_acceptances")
      .select("*")
      .order("accepted_at", { ascending: false })
      .limit(300);
    if (filter?.bookingId) query = query.eq("booking_id", filter.bookingId);
    if (filter?.email) query = query.ilike("email", filter.email);
    const { data, error } = await query;
    if (error) return null;
    return (data || []).map((row) => mapAcceptance(row as Record<string, unknown>));
  } catch {
    return null;
  }
}

async function readSettings(): Promise<ComplianceSettings | null> {
  try {
    const { getAdminSupabase } = await import("@/lib/airtable/sources/admin-client");
    const { data, error } = await getAdminSupabase()
      .from("compliance_settings")
      .select("value")
      .eq("id", "default")
      .maybeSingle();
    if (error || !data?.value || typeof data.value !== "object") return null;
    return { ...DEFAULT_SETTINGS, ...(data.value as Partial<ComplianceSettings>) };
  } catch {
    return null;
  }
}

async function mirror(table: string, row: Record<string, unknown>, conflict?: string) {
  try {
    const { getAdminSupabase } = await import("@/lib/airtable/sources/admin-client");
    const supabase = getAdminSupabase();
    const query = conflict
      ? supabase.from(table).upsert(row, { onConflict: conflict })
      : supabase.from(table).insert(row);
    await query;
  } catch {
    // The in-process store still holds the record when the table is not migrated.
  }
}

async function recordEmailMarketingConsent(records: AcceptanceRecord[]) {
  const accepted = records.filter((row) => row.kind === "email_marketing" && row.action === "accepted" && row.email);
  if (!accepted.length) return;
  try {
    const { getAdminSupabase } = await import("@/lib/airtable/sources/admin-client");
    const supabase = getAdminSupabase();
    for (const row of accepted) {
      const email = String(row.email).trim().toLowerCase();
      const { data: existing } = await supabase.from("email_marketing_contacts").select("status").eq("email", email).maybeSingle();
      if (existing?.status === "unsubscribed") continue;
      const now = new Date().toISOString();
      await supabase.from("email_marketing_contacts").upsert({
        email,
        status: "subscribed",
        source: "booking_form",
        source_note: "Checked the optional email marketing box while booking.",
        consent_basis: String(row.wordingShown || "").slice(0, 500),
        consented_at: now,
        unsubscribed_at: null,
        updated_at: now,
      }, { onConflict: "email" });
      await supabase.from("email_consent_events").insert({
        email,
        actor: "contact",
        previous_status: existing?.status || "not_asked",
        next_status: "subscribed",
        source: "booking_form",
        detail: "Accepted email marketing while booking.",
      });
    }
  } catch {
    // The acceptance itself is already stored. Consent sync can be retried from the record.
  }
}

async function prepDispute(records: AcceptanceRecord[]) {
  const bookingId = records.find((row) => row.bookingId)?.bookingId;
  if (!bookingId) return;
  const disputeRows = records.filter((row) => row.action === "accepted");
  const acknowledgments = disputeAcknowledgments(disputeRows);
  if (!acknowledgments.length) return;
  const snapshot = policySnapshotFrom(disputeRows);
  try {
    const { getAdminSupabase } = await import("@/lib/airtable/sources/admin-client");
    const supabase = getAdminSupabase();
    const first = disputeRows[0];
    await supabase.functions.invoke("dispute-evidence", {
      body: {
        action: "prep",
        kind: "acceptance",
        bookingId,
        clientKey: first.email,
        chargeKey: first.chargeId || bookingId,
        seriesId: `agreement:${bookingId}`,
        eventId: `acceptance:${bookingId}`,
        input: {
          disputeId: `prep-${bookingId}`,
          reason: "general",
          customerEmail: first.email,
          customerName: first.personName,
          bookingRef: bookingId,
          acceptance: {
            signerName: first.personName,
            email: first.email,
            phone: first.phone,
            signedAt: first.acceptedAt,
            ip: first.ip,
            userAgent: first.userAgent,
            agreementVersion: first.wordingVersionId,
            amountLabel: first.amountBasis,
            relationship: first.relationship || "residential",
            acknowledgments,
          },
          policySnapshot: snapshot,
        },
      },
    });
  } catch {
    // Dispute prep is best-effort. The acceptance rows are already stored.
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "settings";
  const store = getProcessStore();
  if (view === "settings") {
    const settings = (await readSettings()) || store.getSettings();
    return NextResponse.json({
      salesTaxEnabled: settings.salesTaxEnabled,
      salesTaxRate: settings.salesTaxRate,
      salesTaxLabel: settings.salesTaxLabel,
      salesTaxByService: settings.salesTaxByService,
      licenseLine: settings.licenseLine,
      urgency: settings.urgency,
      accessRetentionDays: settings.accessRetentionDays,
    });
  }
  if (view === "site_facts") {
    try {
      await requireAdmin(req);
    } catch (err) {
      const status = err instanceof AdminAuthError ? err.status : 401;
      return NextResponse.json({ error: err instanceof Error ? err.message : "Not signed in." }, { status });
    }
    return NextResponse.json({
      review: DRAFT_REVIEW_LABEL,
      facts: PUBLIC_SITE,
      gaps: ADMIN_GAPS,
    });
  }
  try {
    await requireAdmin(req);
  } catch (err) {
    const status = err instanceof AdminAuthError ? err.status : 401;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Not signed in." }, { status });
  }
  if (view === "acceptances") {
    const bookingId = url.searchParams.get("bookingId") || undefined;
    const email = url.searchParams.get("email") || undefined;
    const rows = (await readAcceptances({ bookingId, email })) || store.listAcceptances({ bookingId, email });
    const all = (await readAcceptances()) || store.listAcceptances();
    return NextResponse.json({ acceptances: rows, drafts: liveDraftAcceptances(all) });
  }
  if (view === "drafts") {
    const all = (await readAcceptances()) || store.listAcceptances();
    return NextResponse.json({ drafts: liveDraftAcceptances(all) });
  }
  if (view === "wording") return NextResponse.json({ wording: store.listWording() });
  if (view === "requests") return NextResponse.json({ requests: store.listDataRequests() });
  if (view === "cookies") return NextResponse.json({ cookies: store.listCookies() });
  if (view === "audit") {
    const { AUDIT_FINDINGS, ACCESSIBILITY_PLAN, APPROVED_CLAIMS } = await import("@/lib/compliance");
    return NextResponse.json({
      findings: AUDIT_FINDINGS,
      accessibility: ACCESSIBILITY_PLAN,
      claims: APPROVED_CLAIMS,
      settings: (await readSettings()) || store.getSettings(),
    });
  }
  return NextResponse.json({ settings: (await readSettings()) || store.getSettings() });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = String(body.action || "");
  const store = getProcessStore();
  const now = new Date();
  const nowIso = now.toISOString();

  if (action === "record_acceptances") {
    const incoming = Array.isArray(body.records) ? body.records : [];
    const stored: AcceptanceRecord[] = [];
    for (const raw of incoming) {
      const record = raw as AcceptanceRecord;
      if (!record?.kind || !record.wordingShown || !record.wordingVersionId) continue;
      const row: AcceptanceRecord = {
        ...record,
        id: crypto.randomUUID(),
        action: record.action === "withdrawn" ? "withdrawn" : "accepted",
        acceptedAt: nowIso,
        timeZone: "UTC",
        deviceTimeZone: typeof body.deviceTimeZone === "string" ? body.deviceTimeZone : record.deviceTimeZone,
        ip: clientIp(req),
        userAgent: req.headers.get("user-agent") || record.userAgent || "",
      };
      stored.push(store.addAcceptance(row));
      await mirror("compliance_acceptances", {
        id: row.id,
        kind: row.kind,
        action: row.action,
        wording_version_id: row.wordingVersionId,
        wording_version: row.wordingVersion,
        wording_status: row.wordingStatus,
        wording_shown: row.wordingShown,
        accepted_at: row.acceptedAt,
        time_zone: row.timeZone,
        device_time_zone: row.deviceTimeZone,
        ip: row.ip,
        user_agent: row.userAgent,
        person_name: row.personName,
        email: row.email,
        phone: row.phone,
        booking_id: row.bookingId,
        agreement_id: row.agreementId,
        charge_id: row.chargeId,
        relationship: row.relationship,
        property_label: row.propertyLabel,
        amount_basis: row.amountBasis,
        surface: row.surface,
      });
    }
    void prepDispute(stored);
    void recordEmailMarketingConsent(stored);
    return NextResponse.json({
      ok: true,
      acceptances: stored,
      disputeAcknowledgments: disputeAcknowledgments(stored),
      policySnapshot: policySnapshotFrom(stored),
    });
  }

  if (action === "cookie") {
    const choice = body.choice as {
      analytics?: boolean;
      advertising?: boolean;
      gpc?: boolean;
      source?: "accept" | "decline" | "custom" | "gpc";
      bannerVersion?: string;
      chosenAt?: string;
      timeZone?: string;
    };
    if (!choice?.source || !choice.bannerVersion) {
      return NextResponse.json({ error: "Cookie choice is incomplete." }, { status: 400 });
    }
    const { cookieChoice } = await import("@/lib/compliance");
    const row = cookieChoice({
      id: crypto.randomUUID(),
      analytics: choice.analytics === true,
      advertising: choice.advertising === true,
      gpc: choice.gpc === true || choice.source === "gpc",
      source: choice.source,
      bannerVersion: choice.bannerVersion,
      chosenAt: nowIso,
      timeZone: choice.timeZone || "UTC",
    });
    store.addCookie(row);
    await mirror("compliance_cookie_choices", {
      id: row.id,
      essential: true,
      analytics: row.analytics,
      advertising: row.advertising,
      gpc: row.gpc,
      source: row.source,
      banner_version: row.bannerVersion,
      chosen_at: row.chosenAt,
      time_zone: row.timeZone,
    });
    return NextResponse.json({ ok: true, choice: row });
  }

  if (action === "data_request") {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const kind = String(body.kind || "");
    if (!name || !email.includes("@") || !["access", "correct", "delete"].includes(kind)) {
      return NextResponse.json({ error: "Name, email, and a request type are required." }, { status: 400 });
    }
    const request = openDataRequest({
      id: crypto.randomUUID(),
      name,
      email,
      phone: typeof body.phone === "string" ? body.phone : null,
      kind: kind as "access" | "correct" | "delete",
      details: String(body.details || ""),
      now,
      dueDays: ((await readSettings()) || store.getSettings()).dataRequestDueDays,
    });
    store.addDataRequest(request);
    await mirror("compliance_data_requests", {
      id: request.id,
      name: request.name,
      email: request.email,
      phone: request.phone,
      kind: request.kind,
      details: request.details,
      status: request.status,
      due_on: request.dueOn,
      retained_because: request.retainedBecause,
      log: request.log,
      created_at: request.createdAt,
    });
    return NextResponse.json({ ok: true, request });
  }

  if (action === "sms") {
    const phone = phoneDigits(typeof body.phone === "string" ? body.phone : "");
    const keyword = smsKeyword(typeof body.message === "string" ? body.message : "");
    if (!phone || phone.length < 10) return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
    if (keyword === "help") return NextResponse.json({ ok: true, reply: SMS_HELP_REPLY });
    if (keyword === "start") {
      store.liftSms(phone, nowIso);
      await mirror("compliance_sms_suppressions", { phone_digits: phone, lifted_at: nowIso }, "phone_digits");
      return NextResponse.json({ ok: true, suppressed: false });
    }
    if (keyword !== "stop") return NextResponse.json({ error: "Not a STOP or HELP message." }, { status: 400 });
    store.suppressSms(phone, nowIso, "stop");
    await mirror(
      "compliance_sms_suppressions",
      { phone_digits: phone, suppressed_at: nowIso, source: "stop", lifted_at: null },
      "phone_digits",
    );
    const surface = (body.surface as Surface) || "pay_page";
    const items = acceptancesForSurface(surface, {
      relationship: "residential",
      phone,
      includeCard: false,
    }).filter((item) => item.kind === "sms_service" || item.kind === "sms_promo");
    for (const item of items) {
      const row = buildAcceptanceRecord(
        {
          item,
          surface,
          action: "withdrawn",
          acceptedAt: nowIso,
          timeZone: "UTC",
          ip: clientIp(req),
          userAgent: req.headers.get("user-agent") || "",
          phone,
          email: typeof body.email === "string" ? body.email : null,
          personName: typeof body.name === "string" ? body.name : null,
        },
        crypto.randomUUID(),
      );
      store.addAcceptance(row);
    }
    return NextResponse.json({ ok: true, suppressed: store.isSmsSuppressed(phone), reply: SMS_STOP_REPLY });
  }

  if (action === "access_view") {
    const entry = store.logAccessView({
      id: crypto.randomUUID(),
      bookingId: typeof body.bookingId === "string" ? body.bookingId : null,
      viewerRole: body.viewerRole === "cleaner" ? "cleaner" : "admin",
      viewerId: null,
      viewedAt: nowIso,
      purpose: String(body.purpose || "view access details"),
    });
    await mirror("compliance_access_views", {
      id: entry.id,
      booking_id: entry.bookingId,
      viewer_role: entry.viewerRole,
      viewer_id: entry.viewerId,
      viewed_at: entry.viewedAt,
      purpose: entry.purpose,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "signed_copy") {
    const email = String(body.email || "").trim();
    const lines = Array.isArray(body.lines) ? body.lines.map((line) => String(line)) : [];
    if (!email.includes("@") || !lines.length) {
      return NextResponse.json({ error: "Email and the signed text are required." }, { status: 400 });
    }
    const subject = "Your Novara Cleaning agreement";
    const text = ["This is a copy of what you signed and accepted.", "", ...lines].join("\n");
    const copy = store.addSignedCopy({
      id: crypto.randomUUID(),
      email,
      subject,
      body: text,
      storedAt: nowIso,
      bookingId: typeof body.bookingId === "string" ? body.bookingId : null,
    });
    await mirror("compliance_signed_copies", {
      id: copy.id,
      email: copy.email,
      subject: copy.subject,
      body: copy.body,
      stored_at: copy.storedAt,
      booking_id: copy.bookingId,
    });
    return NextResponse.json({ ok: true, stored: true, emailed: false });
  }

  try {
    await requireAdmin(req);
  } catch (err) {
    const status = err instanceof AdminAuthError ? err.status : 401;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Not signed in." }, { status });
  }

  if (action === "publish_wording") {
    const kind = String(body.kind || "") as WordingKindSafe;
    const title = String(body.title || "").trim();
    const wordingBody = String(body.body || "").trim();
    const status = body.status === "reviewed" ? "reviewed" : "draft";
    if (!title || !wordingBody) return NextResponse.json({ error: "Title and wording are required." }, { status: 400 });
    const row = store.publishWording({ kind, title, body: wordingBody, status, actor: "admin", now: nowIso });
    await mirror("compliance_wording_versions", {
      id: row.id,
      kind: row.kind,
      version: row.version,
      status: row.status,
      title: row.title,
      body: row.body,
      created_at: row.createdAt,
      created_by: row.createdBy,
    });
    return NextResponse.json({ ok: true, wording: row });
  }

  if (action === "review_wording") {
    const row = store.setWordingStatus(String(body.id || ""), body.status === "reviewed" ? "reviewed" : "draft");
    return NextResponse.json({ ok: true, wording: row });
  }

  if (action === "save_settings") {
    const next = { ...DEFAULT_SETTINGS, ...(body.settings as Partial<ComplianceSettings>) } as ComplianceSettings;
    next.salesTaxEnabled = next.salesTaxEnabled === true;
    next.licenseLine = String(next.licenseLine || "");
    if (!next.autoRenewalNoticeDays) next.autoRenewalNoticeDays = { MD: 0, VA: 0, DC: 0 };
    const saved = store.saveSettings(next);
    await mirror("compliance_settings", { id: "default", value: saved }, "id");
    return NextResponse.json({ ok: true, settings: saved });
  }

  if (action === "update_request") {
    const updated = store.updateDataRequest(String(body.id || ""), {
      at: nowIso,
      action: String(body.logAction || "updated"),
      note: String(body.note || ""),
      status: body.status === "done" || body.status === "in_progress" || body.status === "open" ? body.status : undefined,
      retainedBecause: typeof body.retainedBecause === "string" ? body.retainedBecause : undefined,
    });
    return NextResponse.json({ ok: true, request: updated });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

type WordingKindSafe = Parameters<ReturnType<typeof getProcessStore>["publishWording"]>[0]["kind"];

void 0 as AcceptanceKind;
