// Mint, send, and flag contractor statement requests.
// Overdue never writes Score, accountability, cleaner status, or qc_issues.status.

import {
  dueAtFromNow,
  factualReportSummary,
  formatDueBy,
  formatServiceDate,
  generalLocation,
  parseQcStatementSettings,
  QC_STATEMENT_SETTINGS_KEY,
  qcStatementLink,
  statementKindForIssue,
  statementSmsMessage,
  tokenExpiresAt,
  type QcStatementSettings,
} from "./qc-statement.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

const log = (m: string, d?: unknown) =>
  console.log(`[qc-statement] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

export async function loadQcStatementSettings(admin: SB): Promise<QcStatementSettings> {
  const { data } = await admin.from("app_settings").select("value").eq("key", QC_STATEMENT_SETTINGS_KEY).maybeSingle();
  return parseQcStatementSettings(data?.value);
}

export async function loadStatementJobContext(admin: SB, bookingId: string | null) {
  if (!bookingId) {
    return { serviceDate: "", city: "", state: "", serviceType: "", bookingRef: "" };
  }
  const { data } = await admin
    .from("bookings")
    .select("service_date, city, state, service_type, booking_number")
    .eq("id", bookingId)
    .maybeSingle();
  const n = data?.booking_number;
  return {
    serviceDate: String(data?.service_date || ""),
    city: String(data?.city || ""),
    state: String(data?.state || ""),
    serviceType: String(data?.service_type || "").replace(/_/g, " "),
    bookingRef: n ? `NVC-${String(n).padStart(4, "0")}` : "",
  };
}

async function sendStatementChannels(
  admin: SB,
  cleaner: Record<string, unknown>,
  args: {
    link: string;
    generalLocation: string;
    serviceDate: string;
    dueBy: string;
    reminder: boolean;
  },
): Promise<{ emailed: boolean; smsSent: boolean; emailError: string | null; smsError: string | null }> {
  const firstName = String(cleaner.first_name || "").trim() || "there";
  const email = String(cleaner.email || "").trim();
  const phone = String(cleaner.phone || "").trim();
  const out = {
    emailed: false,
    smsSent: false,
    emailError: null as string | null,
    smsError: null as string | null,
  };

  if (email && !email.toLowerCase().endsWith("@pending.novara")) {
    try {
      const { data, error } = await admin.functions.invoke("send-cleaner-email", {
        body: {
          type: "qc_statement_request",
          email,
          data: {
            firstName,
            statementUrl: args.link,
            generalLocation: args.generalLocation,
            serviceDate: args.serviceDate,
            dueBy: args.dueBy,
            reminder: args.reminder,
          },
        },
      });
      out.emailed = !error && !(data as { error?: string } | null)?.error;
      if (!out.emailed) out.emailError = error?.message || (data as { error?: string } | null)?.error || "Email failed";
    } catch (e) {
      out.emailError = e instanceof Error ? e.message : String(e);
    }
  } else if (!email) {
    out.emailError = "No email on the contractor record.";
  } else {
    out.emailError = "Placeholder email is not sendable.";
  }

  if (!phone) {
    out.smsError = "No phone on the contractor record.";
  } else if (cleaner.sms_notifications_enabled === false) {
    out.smsError = "SMS notifications are off for this contractor.";
  } else {
    try {
      const message = statementSmsMessage({
        firstName,
        generalLocation: args.generalLocation,
        serviceDate: args.serviceDate,
        dueBy: args.dueBy,
        link: args.link,
        reminder: args.reminder,
      });
      const { data, error } = await admin.functions.invoke("send-ghl-sms", {
        body: {
          phone,
          email: email || undefined,
          firstName,
          lastName: cleaner.last_name || undefined,
          message,
          type: args.reminder ? "qc_statement_reminder" : "qc_statement_request",
        },
      });
      out.smsSent = !error && !(data as { error?: string } | null)?.error;
      if (!out.smsSent) out.smsError = error?.message || (data as { error?: string } | null)?.error || "SMS failed";
    } catch (e) {
      out.smsError = e instanceof Error ? e.message : String(e);
    }
  }

  return out;
}

export async function requestQcStatement(admin: SB, opts: {
  issue: Record<string, unknown>;
  actorId?: string | null;
  actorName?: string;
  supplemental?: boolean;
  resend?: boolean;
  settings?: QcStatementSettings;
}): Promise<{
  ok: boolean;
  error?: string;
  requestId?: string;
  reused?: boolean;
  emailed?: boolean;
  smsSent?: boolean;
  emailError?: string | null;
  smsError?: string | null;
}> {
  const issue = opts.issue;
  const issueId = String(issue.id || "");
  const cleanerId = String(issue.cleaner_id || "");
  if (!issueId) return { ok: false, error: "issue id required" };
  if (!cleanerId) return { ok: false, error: "Attach a contractor before requesting a statement." };

  const settings = opts.settings || await loadQcStatementSettings(admin);
  const { data: cleaner } = await admin
    .from("cleaners")
    .select("id, first_name, last_name, email, phone, sms_notifications_enabled, status")
    .eq("id", cleanerId)
    .maybeSingle();
  if (!cleaner) return { ok: false, error: "Contractor not found." };

  const { count: subCount } = await admin
    .from("qc_statement_submissions")
    .select("id", { count: "exact", head: true })
    .eq("issue_id", issueId);
  const existingSubs = Number(subCount || 0);
  const kind = opts.supplemental || existingSubs > 0 ? "supplemental" : "original";

  const { data: openRows } = await admin
    .from("qc_statement_requests")
    .select("*")
    .eq("issue_id", issueId)
    .eq("status", "requested")
    .order("created_at", { ascending: false })
    .limit(1);
  const open = (openRows || [])[0] as Record<string, unknown> | undefined;

  const now = new Date();
  const due = open?.due_at && opts.resend && !opts.supplemental
    ? new Date(String(open.due_at))
    : dueAtFromNow(settings, now);
  const expires = tokenExpiresAt(due, settings, now);
  const job = await loadStatementJobContext(admin, String(issue.booking_id || "") || null);
  const loc = generalLocation(job.city, job.state);
  const serviceDateLabel = formatServiceDate(job.serviceDate);
  const dueLabel = formatDueBy(due);
  const reportSummary = String(issue.statement_report_summary || "").trim()
    || factualReportSummary({
      description: String(issue.description || ""),
      title: String(issue.title || ""),
      clientName: String(issue.client_name || ""),
    });

  let requestId: string;
  let reused = false;

  if (open && !opts.supplemental) {
    requestId = String(open.id);
    reused = true;
    await admin.from("qc_statement_requests").update({
      due_at: due.toISOString(),
      token_expires_at: expires.toISOString(),
      report_summary: reportSummary,
      updated_at: now.toISOString(),
    }).eq("id", requestId);
  } else {
    const { data: inserted, error: insErr } = await admin
      .from("qc_statement_requests")
      .insert({
        issue_id: issueId,
        cleaner_id: cleanerId,
        kind,
        status: "requested",
        due_at: due.toISOString(),
        token_expires_at: expires.toISOString(),
        report_summary: reportSummary,
        created_by: opts.actorId || null,
        created_by_name: opts.actorName || null,
      })
      .select("id")
      .single();
    if (insErr || !inserted) return { ok: false, error: insErr?.message || "Could not create statement request." };
    requestId = inserted.id;
  }

  const { data: token, error: mintErr } = await admin.rpc("mint_qc_statement_token", {
    p_request_id: requestId,
    p_ttl_days: settings.token_ttl_days,
  });
  if (mintErr || !token) return { ok: false, error: mintErr?.message || "Could not mint statement link." };

  const link = qcStatementLink(String(token));
  const sent = await sendStatementChannels(admin, cleaner, {
    link,
    generalLocation: loc,
    serviceDate: serviceDateLabel,
    dueBy: dueLabel,
    reminder: false,
  });

  await admin.from("qc_statement_requests").update({
    sent_at: now.toISOString(),
    emailed: sent.emailed,
    sms_sent: sent.smsSent,
    email_error: sent.emailError,
    sms_error: sent.smsError,
    updated_at: now.toISOString(),
  }).eq("id", requestId);

  const issueStatus = existingSubs > 0 ? "submitted" : "requested";
  await admin.from("qc_issues").update({
    statement_required: true,
    statement_status: issueStatus,
    statement_due_at: due.toISOString(),
    statement_requested_at: issue.statement_requested_at || now.toISOString(),
    statement_report_summary: reportSummary,
    statement_not_provided_at: existingSubs > 0 ? issue.statement_not_provided_at : null,
    updated_at: now.toISOString(),
  }).eq("id", issueId);

  await admin.from("qc_issue_events").insert({
    issue_id: issueId,
    action: "statement_requested",
    note: `${kind === "supplemental" ? "Supplemental" : "Contractor"} statement requested` +
      ` (due ${dueLabel}; email ${sent.emailed ? "sent" : "not sent"}, SMS ${sent.smsSent ? "sent" : "not sent"}).`,
    actor_id: opts.actorId || null,
    actor_name: opts.actorName || "System",
    data: {
      request_id: requestId,
      kind,
      reused,
      emailed: sent.emailed,
      sms_sent: sent.smsSent,
      due_at: due.toISOString(),
      no_auto_score_penalty: true,
      no_auto_accountability: true,
    },
  });

  const name = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "contractor";
  await admin.from("events").insert({
    event_type: "qc.statement.requested",
    booking_id: issue.booking_id || null,
    job_id: issue.job_id || null,
    cleaner_id: cleanerId,
    source: "qc-statement",
    summary:
      `Statement ${kind} requested from ${name} on QC #${issue.issue_number || ""} (${issue.booking_ref || ""}). ` +
      `Due ${dueLabel}. Email ${sent.emailed ? "sent" : "not sent"}; SMS ${sent.smsSent ? "sent" : "not sent"}. ` +
      `No conclusion has been reached.`,
    data: { issue_id: issueId, request_id: requestId, kind, emailed: sent.emailed, sms_sent: sent.smsSent },
  }).then(() => undefined, () => undefined);

  try {
    await admin.functions.invoke("qc-statement-drive", { body: { action: "ensure_folder", issueId } });
  } catch {
    /* Drive folder is best-effort at send time */
  }

  log("requested", { issueId, requestId, reused, emailed: sent.emailed, smsSent: sent.smsSent });
  return {
    ok: true,
    requestId,
    reused,
    emailed: sent.emailed,
    smsSent: sent.smsSent,
    emailError: sent.emailError,
    smsError: sent.smsError,
  };
}

void statementKindForIssue;

export async function remindQcStatement(admin: SB, request: Record<string, unknown>, settings: QcStatementSettings) {
  if (request.reminder_sent_at || request.submitted_at || String(request.status) !== "requested") {
    return { ok: true, skipped: true };
  }
  const { data: cleaner } = await admin
    .from("cleaners")
    .select("id, first_name, last_name, email, phone, sms_notifications_enabled")
    .eq("id", request.cleaner_id)
    .maybeSingle();
  if (!cleaner) return { ok: false, error: "cleaner missing" };
  const { data: issue } = await admin.from("qc_issues").select("*").eq("id", request.issue_id).maybeSingle();
  if (!issue) return { ok: false, error: "issue missing" };
  const job = await loadStatementJobContext(admin, issue.booking_id);
  const link = request.token ? qcStatementLink(String(request.token)) : "";
  if (!link) return { ok: false, error: "no token" };
  const sent = await sendStatementChannels(admin, cleaner, {
    link,
    generalLocation: generalLocation(job.city, job.state),
    serviceDate: formatServiceDate(job.serviceDate),
    dueBy: formatDueBy(String(request.due_at)),
    reminder: true,
  });
  const now = new Date().toISOString();
  await admin.from("qc_statement_requests").update({
    reminder_sent_at: now,
    emailed: request.emailed || sent.emailed,
    sms_sent: request.sms_sent || sent.smsSent,
    updated_at: now,
  }).eq("id", request.id);
  await admin.from("qc_issue_events").insert({
    issue_id: request.issue_id,
    action: "statement_reminded",
    note: `Statement reminder sent (due ${formatDueBy(String(request.due_at))}).`,
    actor_name: "System",
    data: {
      request_id: request.id,
      emailed: sent.emailed,
      sms_sent: sent.smsSent,
      reminder_hours_before: settings.reminder_hours_before,
    },
  });
  return { ok: true, emailed: sent.emailed, smsSent: sent.smsSent };
}

/**
 * Flag Statement Not Provided. Does not change Score, accountability,
 * cleaner status, or the QC case's workflow status.
 */
export async function markStatementNotProvided(admin: SB, request: Record<string, unknown>) {
  const { count } = await admin
    .from("qc_statement_submissions")
    .select("id", { count: "exact", head: true })
    .eq("issue_id", request.issue_id);
  if (Number(count || 0) > 0) {
    await admin.from("qc_statement_requests").update({
      status: "submitted",
      updated_at: new Date().toISOString(),
    }).eq("id", request.id);
    return { ok: true, skipped: true, reason: "already_submitted" };
  }

  const now = new Date().toISOString();
  const dueDate = String(request.due_at || now).slice(0, 10);
  await admin.from("qc_statement_requests").update({
    status: "not_provided",
    not_provided_at: now,
    updated_at: now,
  }).eq("id", request.id);

  await admin.from("qc_issues").update({
    statement_status: "not_provided",
    statement_not_provided_at: now,
    updated_at: now,
  }).eq("id", request.issue_id);

  await admin.from("qc_issue_events").insert({
    issue_id: request.issue_id,
    action: "statement_not_provided",
    note: `Statement not provided as of ${dueDate}. Recorded factually — no Score, accountability, or status change.`,
    actor_name: "System",
    data: {
      request_id: request.id,
      due_at: request.due_at,
      not_provided_at: now,
      no_auto_score_penalty: true,
      no_auto_accountability: true,
      no_auto_status_change: true,
    },
  });

  const { data: issue } = await admin
    .from("qc_issues")
    .select("issue_number, booking_ref, booking_id, job_id, cleaner_id, cleaner_name, status")
    .eq("id", request.issue_id)
    .maybeSingle();

  await admin.from("events").insert({
    event_type: "qc.statement.not_provided",
    booking_id: issue?.booking_id || null,
    job_id: issue?.job_id || null,
    cleaner_id: issue?.cleaner_id || request.cleaner_id,
    source: "qc-statement",
    summary:
      `Statement not provided on QC #${issue?.issue_number || ""} (${issue?.booking_ref || ""})` +
      `${issue?.cleaner_name ? ` — ${issue.cleaner_name}` : ""}. Due date ${dueDate} passed with no submission. ` +
      `Case status remains ${issue?.status || "unchanged"}. No Score or accountability action was taken.`,
    data: {
      issue_id: request.issue_id,
      request_id: request.id,
      due_at: request.due_at,
      no_auto_score_penalty: true,
      no_auto_accountability: true,
      no_auto_status_change: true,
    },
  }).then(() => undefined, () => undefined);

  return { ok: true };
}
