// Read-only evidence assembly for a QC case file. Never updates bookings,
// photos, GHL, comms, or cleaner rows. Optional persist writes only onto
// the qc_issues row being assembled (append-only snapshot).

import {
  buildIncidentDayTimeline,
  flattenChecklistItems,
  last10Digits,
  phonesMatch,
  scheduledWindowStartIso,
  type TimelineEventInput,
} from "./qc-incident.ts";
import { fetchGhlContactHistory, type GhlContactHistory } from "./ghl-conversations.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export async function listPhotoMeta(admin: SB, bookingId: string, urls: string[]): Promise<Array<{
  url: string;
  path: string | null;
  created_at: string | null;
  original_timestamp_source: string;
}>> {
  const listed: Array<{ name: string; created_at?: string; updated_at?: string; path: string }> = [];
  async function walk(prefix: string, depth = 0) {
    if (depth > 6) return;
    const { data } = await admin.storage.from("cleaner-job-photos").list(prefix, { limit: 1000 });
    for (const e of (data || []) as Array<{ name: string; id: string | null; created_at?: string; updated_at?: string }>) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id == null) await walk(path, depth + 1);
      else listed.push({ name: e.name, created_at: e.created_at, updated_at: e.updated_at, path });
    }
  }
  try {
    await walk(`bookings/${bookingId}`);
  } catch {
    /* storage listing is best-effort; missing timestamps become timeline gaps */
  }
  return urls.map((url) => {
    const match = listed.find((f) => url.includes(f.path) || url.includes(encodeURIComponent(f.path)) || url.endsWith(f.name));
    return {
      url,
      path: match?.path || null,
      created_at: match?.created_at || match?.updated_at || null,
      original_timestamp_source: match?.created_at
        ? "storage.object.created_at"
        : "not stored — booking only holds the URL",
    };
  });
}

async function commsForPhonesEmails(
  admin: SB,
  phones: string[],
  emails: string[],
): Promise<{ sms_logs: unknown[]; partnership_messages: unknown[]; gaps: string[] }> {
  const gaps: string[] = [];
  const digits = phones.map(last10Digits).filter(Boolean) as string[];
  let sms: unknown[] = [];
  try {
    const { data } = await admin.from("sms_logs")
      .select("id, created_at, to_phone, message, type, status, twilio_sid, error_message, job_assignment_id")
      .order("created_at", { ascending: true })
      .limit(2000);
    sms = (data || []).filter((r: { to_phone?: string }) =>
      digits.some((d) => str(r.to_phone).replace(/\D/g, "").endsWith(d)),
    );
  } catch (e) {
    gaps.push(`sms_logs could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }

  let partnership: unknown[] = [];
  try {
    const filters: string[] = [];
    for (const e of emails.filter(Boolean)) filters.push(`to_email.ilike.${e}`);
    for (const p of phones.filter(Boolean)) filters.push(`to_phone.eq.${p}`);
    // Also match last-10 in app code after a broader fetch if needed.
    let q = admin.from("partnership_messages")
      .select("id, created_at, sent_at, failed_at, template_key, channel, status, to_email, to_phone, subject, body, provider, provider_id, error, recipient_key")
      .order("created_at", { ascending: true })
      .limit(2000);
    if (filters.length) q = q.or(filters.join(","));
    const { data } = await q;
    partnership = (data || []).filter((r: { to_phone?: string; to_email?: string }) => {
      if (emails.some((e) => e && str(r.to_email).toLowerCase() === e.toLowerCase())) return true;
      return phones.some((p) => phonesMatch(p, r.to_phone));
    });
  } catch (e) {
    gaps.push(`partnership_messages could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { sms_logs: sms, partnership_messages: partnership, gaps };
}

export async function assembleIncidentEvidence(admin: SB, opts: {
  booking: Record<string, unknown>;
  checklist: Record<string, unknown> | null;
  events: Array<{ event_type?: string; occurred_at?: string; source?: string; summary?: string; data?: unknown }>;
  ghlToken: string | null;
  ghlLocationId: string | null;
}): Promise<{
  job_record: Record<string, unknown>;
  client_history: unknown[];
  checklist_items: unknown[];
  photos: { before: unknown[]; after: unknown[] };
  field_reports: unknown;
  ghl: { client: GhlContactHistory; contractor: GhlContactHistory };
  comms: { sms_logs: unknown[]; partnership_messages: unknown[]; gaps: string[] };
  contractor_dossier: Record<string, unknown>;
  incident_timeline: unknown[];
  evidence_gaps: string[];
}> {
  const b = opts.booking;
  const bookingId = str(b.id);
  const email = str(b.email).trim();
  const phone = str(b.phone).trim();
  const evidenceGaps: string[] = [];

  const beforeUrls = (Array.isArray(b.before_photos) ? b.before_photos : []).map(str).filter((u) => u.startsWith("http"));
  const afterUrls = (Array.isArray(b.after_photos) ? b.after_photos : []).map(str).filter((u) => u.startsWith("http"));
  const [beforeMeta, afterMeta] = await Promise.all([
    listPhotoMeta(admin, bookingId, beforeUrls),
    listPhotoMeta(admin, bookingId, afterUrls),
  ]);

  const snapshot = (opts.checklist?.sections_snapshot || null) as { sections?: Array<{ title?: string; items?: string[] }> } | null;
  const checklistItems = flattenChecklistItems(opts.checklist?.items, snapshot?.sections || null);

  const cleanerId = b.cleaner_id ? str(b.cleaner_id) : null;
  let cleaner: Record<string, unknown> | null = null;
  if (cleanerId) {
    const { data } = await admin.from("cleaners").select(
      "id, first_name, last_name, email, phone, status, created_at, start_date, " +
      "novara_score, quality_score, overall_score, completed_bookings, " +
      "insurance_verified, insurance_carrier, insurance_policy_number, insurance_expires_at, " +
      "ob_agreement_signed, ob_agreement_signed_at, supply_inventory, supply_checklist_submitted_at, " +
      "background_check_status, background_check_date, background_check_expires_at, " +
      "ghl_user_id, ghl_synced_at, active_strike_count, suspended_at, suspended_until, suspension_reason",
    ).eq("id", cleanerId).maybeSingle();
    cleaner = data || null;
  } else {
    evidenceGaps.push("No cleaner_id on the booking; contractor dossier is incomplete.");
  }

  const clientHistoryQ = admin.from("bookings")
    .select("id, booking_number, service_date, service_type, status, cancel_reason, created_at, completed_at, time_slot, arrival_window, add_ons, pets")
    .order("created_at", { ascending: true })
    .limit(100);
  const orParts: string[] = [];
  if (email) orParts.push(`email.ilike.${email}`);
  if (b.customer_id) orParts.push(`customer_id.eq.${b.customer_id}`);
  const { data: clientHistory } = orParts.length
    ? await clientHistoryQ.or(orParts.join(","))
    : { data: [] };

  let priorQc: unknown[] = [];
  let priorActions: unknown[] = [];
  let screening: unknown = null;
  let completedJobCount: number | null = cleaner?.completed_bookings != null
    ? Number(cleaner.completed_bookings)
    : null;
  if (cleanerId) {
    const [qcRes, actRes, countRes] = await Promise.all([
      admin.from("qc_issues").select(
        "id, issue_number, booking_ref, issue_type, severity, status, title, created_at, score_exempt, reclean_status, reclean_classification",
      ).eq("cleaner_id", cleanerId).order("created_at", { ascending: false }).limit(100),
      admin.from("cleaner_accountability_actions").select(
        "id, action_number, action_type, status, reason, note, qc_issue_ref, created_at, created_by_name, severe_cause",
      ).eq("cleaner_id", cleanerId).order("created_at", { ascending: false }).limit(100),
      admin.from("bookings").select("id", { count: "exact", head: true }).eq("cleaner_id", cleanerId).eq("status", "completed"),
    ]);
    priorQc = qcRes.data || [];
    priorActions = actRes.data || [];
    if (typeof countRes.count === "number") completedJobCount = countRes.count;
  }

  if (cleaner?.email || cleaner?.phone) {
    const { data: applicants } = await admin.from("cleaner_applicants")
      .select("id, email, phone, cleaner_id, full_name")
      .or([
        cleaner.email ? `email.ilike.${cleaner.email}` : "",
        cleaner.phone ? `phone.eq.${cleaner.phone}` : "",
        `cleaner_id.eq.${cleanerId}`,
      ].filter(Boolean).join(","))
      .limit(5);
    const applicantIds = (applicants || []).map((a: { id: string }) => a.id);
    if (applicantIds.length) {
      const { data: screens } = await admin.from("phone_screenings")
        .select("id, status, recommendation, submitted_at, screener_name, pdf_path, pdf_status, answers, consents, scorecard")
        .in("applicant_id", applicantIds)
        .eq("status", "submitted")
        .order("submitted_at", { ascending: false })
        .limit(5);
      screening = screens || [];
    } else {
      evidenceGaps.push("No cleaner_applicants row matched this contractor; screening PDF may not be linked.");
    }
  }

  const ghlClientId = str(b.ghl_contact_id) || null;
  const [ghlClient, ghlContractor] = await Promise.all([
    fetchGhlContactHistory({
      token: opts.ghlToken,
      locationId: opts.ghlLocationId,
      party: "client",
      contactId: ghlClientId,
      email: email || null,
      phone: phone || null,
    }),
    fetchGhlContactHistory({
      token: opts.ghlToken,
      locationId: opts.ghlLocationId,
      party: "contractor",
      contactId: null,
      email: cleaner?.email ? str(cleaner.email) : null,
      phone: cleaner?.phone ? str(cleaner.phone) : null,
    }),
  ]);

  const comms = await commsForPhonesEmails(
    admin,
    [phone, cleaner?.phone ? str(cleaner.phone) : ""].filter(Boolean),
    [email, cleaner?.email ? str(cleaner.email) : ""].filter(Boolean),
  );

  const timelineEvents: TimelineEventInput[] = [];
  const push = (at: unknown, source: string, label: string, raw?: unknown) => {
    timelineEvents.push({ at: at != null && at !== "" ? String(at) : null, source, label, raw });
  };

  push(b.created_at, "bookings.created_at", "Booking created", { booking_number: b.booking_number });
  if (b.confirmed_at) push(b.confirmed_at, "bookings.confirmed_at", "Booking confirmed");
  if (b.time_slot) {
    push(
      scheduledWindowStartIso(str(b.service_date), str(b.time_slot)),
      "bookings.time_slot",
      `Scheduled window (time_slot): ${b.time_slot}`,
      { time_slot: b.time_slot, arrival_window: b.arrival_window, pre_delay_time_slot: b.pre_delay_time_slot, delay_minutes: b.delay_minutes },
    );
  }
  if (b.arrival_window) {
    push(
      scheduledWindowStartIso(str(b.service_date), str(b.arrival_window)),
      "bookings.arrival_window",
      `Arrival window: ${b.arrival_window}${Number(b.delay_minutes) ? ` (delay_minutes=${b.delay_minutes})` : ""}`,
      { arrival_window: b.arrival_window, delay_minutes: b.delay_minutes, pre_delay_time_slot: b.pre_delay_time_slot },
    );
  }
  push(b.check_in_time, "bookings.check_in_time", "Actual check-in / start");
  push(b.check_out_time, "bookings.check_out_time", "Actual check-out");
  push(b.completed_at, "bookings.completed_at", "Job marked complete");
  push(b.cancelled_at, "bookings.cancelled_at", `Booking cancelled${b.cancel_reason ? `: ${b.cancel_reason}` : ""}`);
  push(b.photo_upload_submitted_at, "bookings.photo_upload_submitted_at", "Photo upload submitted");
  push(opts.checklist?.started_at, "job_checklists.started_at", "Checklist started");
  push(opts.checklist?.completed_at, "job_checklists.completed_at", "Checklist completed");

  for (const p of beforeMeta) {
    timelineEvents.push({
      at: p.created_at,
      source: "storage.cleaner-job-photos",
      label: `Before photo${p.created_at ? "" : " (capture timestamp not stored)"}`,
      raw: p,
    });
  }
  for (const p of afterMeta) {
    timelineEvents.push({
      at: p.created_at,
      source: "storage.cleaner-job-photos",
      label: `After photo${p.created_at ? "" : " (capture timestamp not stored)"}`,
      raw: p,
    });
  }
  for (const item of checklistItems) {
    if (item.at) {
      push(item.at, "job_checklists.items", `Checklist ${item.state}: ${item.label}${item.skip_reason ? ` (${item.skip_reason})` : ""}`, item);
    }
  }
  for (const ev of opts.events || []) {
    push(ev.occurred_at, `events.${ev.source || "unknown"}`, `${ev.event_type || "event"} — ${ev.summary || ""}`.trim(), ev);
  }
  for (const m of ghlClient.messages) {
    const dur = m.callDurationSeconds != null ? ` (duration ${m.callDurationSeconds}s)` : "";
    push(m.at, "ghl.client", `GHL ${m.messageType || "message"} ${m.direction || ""}${dur}`, m);
  }
  for (const n of ghlClient.notes) {
    push(n.at, "ghl.client.notes", "GHL note", n);
  }
  for (const m of ghlContractor.messages) {
    const dur = m.callDurationSeconds != null ? ` (duration ${m.callDurationSeconds}s)` : "";
    push(m.at, "ghl.contractor", `GHL ${m.messageType || "message"} ${m.direction || ""}${dur}`, m);
  }
  for (const row of comms.sms_logs as Array<{ created_at?: string; status?: string; type?: string; to_phone?: string }>) {
    push(row.created_at, "sms_logs", `SMS ${row.type || ""} → ${row.to_phone || ""} (${row.status || "unknown"})`, row);
  }
  for (const row of comms.partnership_messages as Array<{ created_at?: string; sent_at?: string; channel?: string; status?: string; to_phone?: string; to_email?: string; template_key?: string }>) {
    push(row.sent_at || row.created_at, "partnership_messages", `${row.channel} ${row.template_key || ""} → ${row.to_phone || row.to_email || ""} (${row.status})`, row);
  }

  const absent: Array<{ source: string; label: string }> = [];
  if (!b.check_in_time) absent.push({ source: "bookings.check_in_time", label: "No check-in / arrival timestamp on the booking." });
  if (!b.check_out_time) absent.push({ source: "bookings.check_out_time", label: "No check-out timestamp on the booking." });
  if (!b.completed_at) absent.push({ source: "bookings.completed_at", label: "No completion timestamp on the booking." });
  if (!opts.checklist?.started_at) absent.push({ source: "job_checklists.started_at", label: "Checklist was never started." });
  if (afterUrls.length === 0) absent.push({ source: "bookings.after_photos", label: "No after photos on file." });
  if (beforeUrls.length === 0) absent.push({ source: "bookings.before_photos", label: "No before photos on file." });
  if (checklistItems.length && checklistItems.every((i) => i.state === "not_marked")) {
    absent.push({ source: "job_checklists.items", label: "No checklist items were marked complete or skipped." });
  }
  if (!b.pets || str(b.pets) === "none") {
    absent.push({ source: "bookings.pets", label: `Booking pets field is ${JSON.stringify(b.pets ?? null)} — no pet was recorded on this booking.` });
  }

  const incident_timeline = buildIncidentDayTimeline({
    serviceDate: str(b.service_date) || null,
    events: timelineEvents,
    absentRecords: absent,
  });

  const tenureDays = cleaner?.start_date || cleaner?.created_at
    ? Math.max(0, Math.floor((Date.now() - Date.parse(str(cleaner.start_date || cleaner.created_at))) / 86400000))
    : null;

  evidenceGaps.push(...ghlClient.gaps, ...ghlContractor.gaps, ...comms.gaps);
  if (!ghlClient.configured) evidenceGaps.push("GHL is not connected; client and contractor conversation history could not be pulled.");
  if (!cleaner?.insurance_carrier && !cleaner?.insurance_policy_number) {
    evidenceGaps.push("No general liability carrier or policy number on the contractor record.");
  }
  evidenceGaps.push("No Novara Score history table exists; only the current snapshot is on file.");

  return {
    job_record: {
      date: b.service_date,
      scheduled_window: b.time_slot || null,
      arrival_window: b.arrival_window || null,
      pre_delay_time_slot: b.pre_delay_time_slot || null,
      delay_minutes: b.delay_minutes ?? 0,
      service_type: b.service_type,
      address: [b.address, b.city, b.state, b.zip_code].filter(Boolean).join(", "),
      assigned_contractor: cleaner
        ? { id: cleaner.id, name: `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim(), status: cleaner.status }
        : null,
      booked_scope: {
        service_type: b.service_type,
        add_ons: b.add_ons || [],
        focused_areas: b.focused_areas || null,
        scope_level: b.scope_level || null,
        pets: b.pets ?? null,
        team_notes: b.team_notes || null,
        issues_notes: b.issues_notes || null,
        access_notes: b.access_notes || null,
      },
      actual_timestamps: {
        check_in_time: b.check_in_time || null,
        check_out_time: b.check_out_time || null,
        completed_at: b.completed_at || null,
        cancelled_at: b.cancelled_at || null,
        cancel_reason: b.cancel_reason || null,
      },
    },
    client_history: clientHistory || [],
    checklist_items: checklistItems,
    photos: { before: beforeMeta, after: afterMeta },
    field_reports: {
      team_notes: b.team_notes || null,
      issues_notes: b.issues_notes || null,
      access_notes: b.access_notes || null,
      section_meta: opts.checklist?.section_meta || null,
    },
    ghl: { client: ghlClient, contractor: ghlContractor },
    comms,
    contractor_dossier: {
      profile: cleaner,
      tenure_days: tenureDays,
      completed_job_count: completedJobCount,
      score_snapshot: cleaner ? {
        novara: cleaner.novara_score ?? null,
        quality: cleaner.quality_score ?? null,
        overall: cleaner.overall_score ?? null,
        history: null,
        history_gap: "No score-history table is on file. Trend cannot be reconstructed from snapshots that were never stored.",
      } : null,
      prior_qc_cases: priorQc,
      prior_accountability_actions: priorActions,
      onboarding: cleaner ? {
        agreement_signed: Boolean(cleaner.ob_agreement_signed),
        agreement_signed_at: cleaner.ob_agreement_signed_at || null,
        supply_checklist_submitted_at: cleaner.supply_checklist_submitted_at || null,
        supply_inventory: cleaner.supply_inventory || null,
        screening,
        insurance: {
          carries_own_gl: Boolean(cleaner.insurance_verified || cleaner.insurance_carrier || cleaner.insurance_policy_number),
          verified: cleaner.insurance_verified ?? null,
          carrier: cleaner.insurance_carrier || null,
          policy_number: cleaner.insurance_policy_number || null,
          expires_at: cleaner.insurance_expires_at || null,
        },
        background_check: {
          status: cleaner.background_check_status || null,
          date: cleaner.background_check_date || null,
          expires_at: cleaner.background_check_expires_at || null,
        },
      } : null,
    },
    incident_timeline,
    evidence_gaps: evidenceGaps.filter(Boolean),
  };
}
