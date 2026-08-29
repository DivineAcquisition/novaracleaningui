// qc-issues
//
// QC issue reporting + lifecycle API. Every issue is tied to a booking, so
// the job's documentation (before/after photos, checklist, Drive packet) is
// its evidence — never a naked complaint.
//
// Two auth paths:
//   • Admin/VA JWT (Authorization header) — full management:
//       { action:'create', bookingId, issueType, severity, title, description? }
//       { action:'update_status', issueId, status, note? }
//       { action:'add_note', issueId, note }
//       { action:'resolve', issueId, note, resolutionPhotos? }
//       { action:'attach_cleaner', issueId, cleanerId }  — must be assigned to the job
//       { action:'detach_cleaner', issueId, cleanerId }
//
// Crew-aware attribution: qc_issues.cleaners (jsonb [{id,name,role}]) holds
// EVERY cleaner on the job (auto-filled at creation from job_assignments);
// cleaner_id/cleaner_name remain the primary (lead) for scoring/compat.
//   • Cleaner field report (job_assignments.response_token — same token the
//     job checklist uses, so a cleaner can flag from the job page):
//       { action:'field_report', token, description, issueType?, severity? }
//
// Every mutation writes a qc_issue_events audit row (who/what/when).
// High/Critical creations + escalations insert public.events rows, which the
// existing Discord routing trigger turns into immediate admin alerts.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  intakeCreatesRecleanRequest,
  loadRecleanSettings,
  namedAreasFromText,
  recleanRequestColumns,
  recleanSourceForIntake,
} from "../_shared/reclean.ts";

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
  console.log(`[qc-issues] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

const ISSUE_TYPES = ["complaint", "reclean", "damage", "no_show", "late", "quality_flag", "payment", "other", "site_finding", "addon"];
const SEVERITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["open", "investigating", "awaiting_customer", "resolved", "escalated"];

async function ensureAdminOrVa(admin: SB, jwt: string): Promise<{ id: string; name: string }> {
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
  const name = String(
    u.user.user_metadata?.full_name || u.user.user_metadata?.name || u.user.email || "Team",
  );
  return { id: u.user.id, name };
}

interface BookingLite {
  id: string;
  job_id: string | null;
  booking_number: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  cleaner_id: string | null;
  booking_type?: string | null;
  partner_details?: Record<string, unknown> | null;
  completed_at?: string | null;
  service_date?: string | null;
  is_reclean?: boolean | null;
}

async function loadBooking(admin: SB, bookingId: string): Promise<BookingLite | null> {
  const { data } = await admin
    .from("bookings")
    .select("id, job_id, booking_number, first_name, last_name, email, cleaner_id, booking_type, partner_details, completed_at, service_date, is_reclean")
    .eq("id", bookingId)
    .maybeSingle();
  return data || null;
}

/** Client type is a tag, not a fork — same mapping as the DB helper. */
function clientTypeOf(b: BookingLite): string {
  const t = String(b.booking_type || "");
  if (t === "commercial") return "commercial";
  if (t === "office") return "office";
  if (t === "str_turnover") return "str";
  if (t === "partnership") {
    return String((b.partner_details as Record<string, unknown> | null)?.booking_type || "") === "str_turnover" ? "str" : "commercial";
  }
  return "residential";
}

function bookingRef(b: BookingLite): string {
  return b.booking_number ? `NVC-${String(b.booking_number).padStart(4, "0")}` : `Job ${b.id.slice(0, 8)}`;
}

interface InvolvedCleaner {
  id: string;
  name: string | null;
  role: string | null;
}

// EVERY cleaner who worked the job (crew jobs have more than one) — the
// lead comes first so the primary cleaner_id/cleaner_name stay stable.
async function cleanersForBooking(admin: SB, b: BookingLite): Promise<InvolvedCleaner[]> {
  const out: InvolvedCleaner[] = [];
  const seen = new Set<string>();
  if (b.job_id) {
    const { data: assigns } = await admin
      .from("job_assignments")
      .select("cleaner_id, status, role, cleaners(first_name, last_name)")
      .eq("job_id", b.job_id);
    const participating = (assigns || []).filter((a: { status?: string }) =>
      ["confirmed", "accepted", "completed", "in progress"].includes(String(a.status || "").toLowerCase()));
    participating.sort((a: { role?: string }, b2: { role?: string }) =>
      (String(a.role || "") === "Lead" ? 0 : 1) - (String(b2.role || "") === "Lead" ? 0 : 1));
    for (const a of participating) {
      if (!a.cleaner_id || seen.has(a.cleaner_id)) continue;
      seen.add(a.cleaner_id);
      const c = Array.isArray(a.cleaners) ? a.cleaners[0] : a.cleaners;
      const name = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : null;
      out.push({ id: a.cleaner_id, name: name || null, role: a.role || null });
    }
  }
  if (out.length === 0 && b.cleaner_id) {
    const { data: c } = await admin.from("cleaners").select("first_name, last_name").eq("id", b.cleaner_id).maybeSingle();
    out.push({
      id: b.cleaner_id,
      name: c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() || null : null,
      role: null,
    });
  }
  return out;
}

async function createIssue(admin: SB, opts: {
  booking: BookingLite;
  issueType: string;
  severity: string;
  title: string;
  description: string | null;
  reportedVia: string;
  reporterId: string | null;
  reporterName: string;
  cleanerId?: string | null;
  cleanerName?: string | null;
  details?: Record<string, unknown> | null;
  requestReclean?: boolean;
}) {
  const ref = bookingRef(opts.booking);
  // ALL cleaners on the job get attached; the reporter (field reports) or
  // the lead is the primary cleaner_id for scoring/compat.
  const involved = await cleanersForBooking(admin, opts.booking);
  const cleaner = opts.cleanerId !== undefined && opts.cleanerId !== null
    ? { id: opts.cleanerId, name: opts.cleanerName ?? null }
    : (involved[0] ?? { id: null, name: null });
  if (cleaner.id && !involved.some((c) => c.id === cleaner.id)) {
    involved.unshift({ id: cleaner.id, name: cleaner.name, role: null });
  }

  const { data: docRow } = await admin
    .from("job_documentation")
    .select("id")
    .eq("booking_id", opts.booking.id)
    .maybeSingle();

  const recleanStamp: Record<string, unknown> = {};
  const wantsReclean = !opts.booking.is_reclean && intakeCreatesRecleanRequest({
    issueType: opts.issueType,
    reportedVia: opts.reportedVia,
    requestReclean: opts.requestReclean,
  });
  if (wantsReclean) {
    const settings = await loadRecleanSettings(admin);
    Object.assign(recleanStamp, recleanRequestColumns({
      completedAt: opts.booking.completed_at,
      serviceDate: opts.booking.service_date,
      windowHours: settings.guarantee_window_hours,
    }), {
      reclean_source: recleanSourceForIntake({ issueType: opts.issueType, reportedVia: opts.reportedVia }),
      reclean_scope: "targeted",
      reclean_areas_named: namedAreasFromText(opts.description),
    });
  }

  const { data: issue, error } = await admin
    .from("qc_issues")
    .insert({
      booking_id: opts.booking.id,
      job_id: opts.booking.job_id,
      client_type: clientTypeOf(opts.booking),
      documentation_id: docRow?.id || null,
      cleaner_id: cleaner.id,
      cleaner_name: cleaner.name,
      cleaners: involved,
      client_name: `${opts.booking.first_name || ""} ${opts.booking.last_name || ""}`.trim() || null,
      client_email: opts.booking.email,
      booking_ref: ref,
      issue_type: opts.issueType,
      severity: opts.severity,
      status: "open",
      title: opts.title,
      description: opts.description,
      details: opts.details && typeof opts.details === "object" ? opts.details : {},
      reported_via: opts.reportedVia,
      reported_by: opts.reporterId,
      reported_by_name: opts.reporterName,
      ...recleanStamp,
    })
    .select("*")
    .single();
  if (error) throw error;

  await admin.from("qc_issue_events").insert({
    issue_id: issue.id,
    action: "created",
    to_status: "open",
    note: opts.description,
    actor_id: opts.reporterId,
    actor_name: opts.reporterName,
    data: { issue_type: opts.issueType, severity: opts.severity, via: opts.reportedVia },
  });

  if (wantsReclean) {
    await admin.from("qc_issue_events").insert({
      issue_id: issue.id,
      action: "reclean_requested",
      note: recleanStamp.reclean_inside_window
        ? "Re-clean request opened inside the Spotless Guarantee window. Verify original photos before dispatch."
        : "Re-clean request opened outside the guarantee window — honor at admin discretion.",
      actor_id: opts.reporterId,
      actor_name: opts.reporterName,
      data: {
        source: recleanStamp.reclean_source,
        inside_window: recleanStamp.reclean_inside_window,
      },
    });
  }

  // Severity drives urgency: High/Critical alert admin immediately through
  // the existing Discord event routing. Low/medium sit in the triage queue.
  if (opts.severity === "high" || opts.severity === "critical") {
    await admin.from("events").insert({
      event_type: "qc.issue.created",
      booking_id: opts.booking.id,
      job_id: opts.booking.job_id,
      cleaner_id: cleaner.id,
      source: "qc-issues",
      summary: `🔴 ${opts.severity.toUpperCase()} QC issue on ${ref} — ${opts.issueType}: ${opts.title}` +
        `${cleaner.name ? ` (cleaner: ${cleaner.name})` : ""}` +
        `${opts.description ? `\n${opts.description.slice(0, 300)}` : ""}` +
        `\nReported by ${opts.reporterName} via ${opts.reportedVia}. Review in the QC console.`,
      data: { issue_id: issue.id, severity: opts.severity, issue_type: opts.issueType },
    }).then(() => undefined, () => undefined);
  }

  return issue;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").toLowerCase();

    // ─── Cleaner field report (token path — no login) ────────────────────
    if (action === "field_report") {
      const token = String(body?.token || "").trim();
      const description = String(body?.description || "").trim().slice(0, 2000);
      if (!token) return json({ ok: false, error: "Missing token" }, 400);
      if (!description) return json({ ok: false, error: "Describe the problem so dispatch can act on it." }, 400);

      const { data: assignment } = await admin
        .from("job_assignments")
        .select("job_id, cleaner_id, status, cleaners(id, first_name, last_name)")
        .eq("response_token", token)
        .maybeSingle();
      if (!assignment?.job_id) return json({ ok: false, error: "Link not found or expired." }, 404);

      const { data: booking } = await admin
        .from("bookings")
        .select("id, job_id, booking_number, first_name, last_name, email, cleaner_id, booking_type, partner_details, completed_at, service_date, is_reclean")
        .eq("job_id", assignment.job_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!booking) return json({ ok: false, error: "Job not found." }, 404);

      const c = Array.isArray(assignment.cleaners) ? assignment.cleaners[0] : assignment.cleaners;
      const cleanerName = c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner" : "Cleaner";
      const issueType = ISSUE_TYPES.includes(String(body?.issueType)) ? String(body.issueType) : "quality_flag";
      // Field reports default HIGH — the stop-and-flag SOP means a cleaner
      // raising a problem on site needs immediate dispatch eyes.
      const severity = SEVERITIES.includes(String(body?.severity)) ? String(body.severity) : "high";

      const issue = await createIssue(admin, {
        booking: booking as BookingLite,
        issueType,
        severity,
        title: `Field report from ${cleanerName}`,
        description,
        reportedVia: "cleaner_field",
        reporterId: null,
        reporterName: cleanerName,
        cleanerId: assignment.cleaner_id || null,
        cleanerName,
        requestReclean: issueType === "reclean",
      });
      return json({ ok: true, issueId: issue.id, issueNumber: issue.issue_number });
    }

    // ─── Admin / VA management (JWT path) ────────────────────────────────
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "Not signed in." }, 401);
    const actor = await ensureAdminOrVa(admin, jwt);
    const nowIso = new Date().toISOString();

    if (action === "create") {
      const bookingId = String(body?.bookingId || "");
      const title = String(body?.title || "").trim().slice(0, 200);
      if (!bookingId) return json({ ok: false, error: "bookingId required — every issue links to a job." }, 400);
      if (!title) return json({ ok: false, error: "title required" }, 400);
      const issueType = ISSUE_TYPES.includes(String(body?.issueType)) ? String(body.issueType) : "complaint";
      const severity = SEVERITIES.includes(String(body?.severity)) ? String(body.severity) : "medium";
      const booking = await loadBooking(admin, bookingId);
      if (!booking) return json({ ok: false, error: "Booking not found." }, 404);

      const issue = await createIssue(admin, {
        booking,
        issueType,
        severity,
        title,
        description: String(body?.description || "").trim().slice(0, 4000) || null,
        reportedVia: "va",
        reporterId: actor.id,
        reporterName: actor.name,
        requestReclean: body?.requestReclean === true
          ? true
          : body?.requestReclean === false
            ? false
            : undefined,
      });
      return json({ ok: true, issue });
    }

    // Remaining actions operate on an existing issue.
    const issueId = String(body?.issueId || "");
    if (!issueId) return json({ ok: false, error: "issueId required" }, 400);
    const { data: issue } = await admin.from("qc_issues").select("*").eq("id", issueId).maybeSingle();
    if (!issue) return json({ ok: false, error: "Issue not found." }, 404);

    // Tag which checklist items this case relates to. Optional by design —
    // a scheduling complaint has no checklist item, and forcing a tag would
    // manufacture signal against whichever item was nearest.
    if (action === "tag_checklist_items") {
      const raw = Array.isArray(body?.checklistItemIds) ? body.checklistItemIds : [];
      const ids = Array.from(
        new Set(raw.map((v: unknown) => String(v).trim()).filter(Boolean)),
      ).slice(0, 60);

      const { error: upErr } = await admin
        .from("qc_issues")
        .update({ checklist_item_ids: ids, updated_at: nowIso })
        .eq("id", issueId);
      if (upErr) throw upErr;

      await admin.from("qc_issue_events").insert({
        issue_id: issueId,
        action: "note",
        note: ids.length
          ? `Tagged ${ids.length} checklist item(s) on this case.`
          : "Cleared checklist item tags on this case.",
        actor_id: actor.id,
        actor_name: actor.name,
        data: { checklist_item_ids: ids },
      });
      return json({ ok: true, checklistItemIds: ids });
    }

    if (action === "update_status") {
      const toStatus = String(body?.status || "");
      if (!STATUSES.includes(toStatus)) return json({ ok: false, error: "Invalid status." }, 400);
      const note = String(body?.note || "").trim().slice(0, 2000) || null;

      const patch: Record<string, unknown> = { status: toStatus, updated_at: nowIso };
      if (toStatus === "resolved") {
        patch.resolved_at = nowIso;
        patch.resolved_by = actor.id;
        patch.resolved_by_name = actor.name;
        if (note) patch.resolution_note = note;
      }
      const { error: upErr } = await admin.from("qc_issues").update(patch).eq("id", issueId);
      if (upErr) throw upErr;

      await admin.from("qc_issue_events").insert({
        issue_id: issueId,
        action: toStatus === "resolved" ? "resolved" : toStatus === "escalated" ? "escalated" : "status_change",
        from_status: issue.status,
        to_status: toStatus,
        note,
        actor_id: actor.id,
        actor_name: actor.name,
      });

      if (toStatus === "escalated") {
        await admin.from("events").insert({
          event_type: "qc.issue.escalated",
          booking_id: issue.booking_id,
          job_id: issue.job_id,
          cleaner_id: issue.cleaner_id,
          source: "qc-issues",
          summary: `⚠️ QC issue ESCALATED on ${issue.booking_ref || issue.booking_id} — ${issue.issue_type}: ${issue.title}` +
            `${note ? `\n${note.slice(0, 300)}` : ""}\nEscalated by ${actor.name}.`,
          data: { issue_id: issueId },
        }).then(() => undefined, () => undefined);
      }
      return json({ ok: true });
    }

    if (action === "add_note") {
      const note = String(body?.note || "").trim().slice(0, 2000);
      if (!note) return json({ ok: false, error: "note required" }, 400);
      await admin.from("qc_issue_events").insert({
        issue_id: issueId,
        action: "note",
        note,
        actor_id: actor.id,
        actor_name: actor.name,
      });
      await admin.from("qc_issues").update({ updated_at: nowIso }).eq("id", issueId);
      return json({ ok: true });
    }

    // ─── Cleaner attachment: crew jobs involve more than one cleaner ─────
    // attach_cleaner goes off the cleaners assigned to the job — the target
    // must have a job_assignments row on this issue's job.
    if (action === "attach_cleaner") {
      const cleanerId = String(body?.cleanerId || "");
      if (!cleanerId) return json({ ok: false, error: "cleanerId required" }, 400);

      const { data: c } = await admin
        .from("cleaners").select("id, first_name, last_name").eq("id", cleanerId).maybeSingle();
      if (!c) return json({ ok: false, error: "Cleaner not found." }, 404);
      const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner";

      let role: string | null = null;
      if (issue.job_id) {
        const { data: assign } = await admin
          .from("job_assignments")
          .select("id, role")
          .eq("job_id", issue.job_id)
          .eq("cleaner_id", cleanerId)
          .limit(1)
          .maybeSingle();
        if (!assign) {
          return json({
            ok: false,
            error: `${name} was not assigned to this job — only cleaners on the job can be attached.`,
          }, 409);
        }
        role = assign.role || null;
      }

      const current: Array<{ id: string }> = Array.isArray(issue.cleaners) ? issue.cleaners : [];
      if (current.some((e) => String(e?.id) === cleanerId)) {
        return json({ ok: true, unchanged: true, cleaners: current });
      }
      const next = [...current, { id: cleanerId, name, role }];
      const patch: Record<string, unknown> = { cleaners: next, updated_at: nowIso };
      if (!issue.cleaner_id) {
        patch.cleaner_id = cleanerId;
        patch.cleaner_name = name;
      }
      const { error: upErr } = await admin.from("qc_issues").update(patch).eq("id", issueId);
      if (upErr) throw upErr;

      await admin.from("qc_issue_events").insert({
        issue_id: issueId,
        action: "note",
        note: `Attached cleaner ${name} to this case (assigned to the job).`,
        actor_id: actor.id,
        actor_name: actor.name,
        data: { attached_cleaner_id: cleanerId },
      });
      return json({ ok: true, cleaners: next });
    }

    if (action === "detach_cleaner") {
      const cleanerId = String(body?.cleanerId || "");
      if (!cleanerId) return json({ ok: false, error: "cleanerId required" }, 400);
      const current: Array<{ id: string; name?: string | null }> = Array.isArray(issue.cleaners) ? issue.cleaners : [];
      const entry = current.find((e) => String(e?.id) === cleanerId);
      if (!entry) return json({ ok: true, unchanged: true, cleaners: current });
      const next = current.filter((e) => String(e?.id) !== cleanerId);
      const patch: Record<string, unknown> = { cleaners: next, updated_at: nowIso };
      // Keep the primary pointer valid.
      if (String(issue.cleaner_id) === cleanerId) {
        patch.cleaner_id = next[0]?.id || null;
        patch.cleaner_name = next[0]?.name || null;
      }
      const { error: upErr } = await admin.from("qc_issues").update(patch).eq("id", issueId);
      if (upErr) throw upErr;

      await admin.from("qc_issue_events").insert({
        issue_id: issueId,
        action: "note",
        note: `Detached cleaner ${entry.name || cleanerId} from this case.`,
        actor_id: actor.id,
        actor_name: actor.name,
        data: { detached_cleaner_id: cleanerId },
      });
      return json({ ok: true, cleaners: next });
    }

    if (action === "resolve") {
      const note = String(body?.note || "").trim().slice(0, 2000);
      if (!note) return json({ ok: false, error: "A resolution note is required." }, 400);
      const photos = Array.isArray(body?.resolutionPhotos)
        ? body.resolutionPhotos.map(String).filter((u: string) => u.startsWith("http")).slice(0, 20)
        : [];

      const { error: upErr } = await admin.from("qc_issues").update({
        status: "resolved",
        resolution_note: note,
        resolution_photos: photos,
        resolved_at: nowIso,
        resolved_by: actor.id,
        resolved_by_name: actor.name,
        updated_at: nowIso,
      }).eq("id", issueId);
      if (upErr) throw upErr;

      await admin.from("qc_issue_events").insert({
        issue_id: issueId,
        action: "resolved",
        from_status: issue.status,
        to_status: "resolved",
        note,
        actor_id: actor.id,
        actor_name: actor.name,
        data: photos.length ? { resolution_photos: photos } : null,
      });
      return json({ ok: true });
    }

    return json({ ok: false, error: `Unknown action '${action}'.` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    const status = msg.includes("Not signed in") ? 401 : msg.includes("only") ? 403 : 500;
    return json({ ok: false, error: msg }, status);
  }
});
