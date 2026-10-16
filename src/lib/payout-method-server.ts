// Persistence for payout methods and the manual pay run.
// Decisions live in payout-methods.ts. This file reads and writes them.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PAYOUT_SETTINGS_KEY,
  activeAcknowledgment,
  adminDetailChangeNotice,
  agedEarnings,
  agingAlert,
  allocateSentCents,
  applyFailed,
  applyPaid,
  applySettingsChange,
  assemblePayRun,
  buildPaymentSummary,
  canSendExistingOptionsNotice,
  cleanerPatchForVerifiedManual,
  confirmationPreview,
  detailChangeNotice,
  existingStripeOptionsNotice,
  findMethod,
  isStalledAtPayoutStep,
  methodsForChoice,
  missingSetupReminder,
  monthlyTotalsByMethod,
  nextPayRunDate,
  paidNotice,
  parsePayoutSettings,
  paymentFailedNotice,
  payoutMethodReport,
  payoutSafeRecord,
  payRunDayReminder,
  reminderIsDue,
  reopenPaid,
  snapshot1099Flag,
  validateManualSubmission,
  verificationCodeNotice,
  weekdayName,
  type ContractorMessage,
  type PayContractor,
  type PayEarning,
  type PayLine,
  type PayoutSettings,
} from "@/lib/payout-methods";
import type { CleanerSetupState } from "@/lib/cleaner-supplies";
import { issueVerificationCode, verificationCodeMatches } from "@/lib/payout-verification";

type DB = SupabaseClient;

const from = (db: DB, table: string) => (db.from as any)(table);

function ymd(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function nameOf(row: { first_name?: string | null; last_name?: string | null }): string {
  return `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Contractor";
}

async function loadSettings(db: DB): Promise<PayoutSettings> {
  const { data, error } = await from(db, "app_settings").select("value").eq("key", PAYOUT_SETTINGS_KEY).maybeSingle();
  if (error) throw new Error(error.message || "Could not read payout settings.");
  return parsePayoutSettings(data?.value);
}

async function saveSettings(db: DB, settings: PayoutSettings): Promise<void> {
  const { error } = await from(db, "app_settings").upsert({
    key: PAYOUT_SETTINGS_KEY,
    value: settings,
    description: "Payout methods, pay run day, change hold, aging, reminders, and the acknowledgment.",
  });
  if (error) throw new Error(error.message || "Could not save payout settings.");
}

async function logEvent(db: DB, event: { type: string; summary: string; cleanerId?: string | null; data?: Record<string, unknown> }) {
  await from(db, "events").insert({
    event_type: event.type,
    cleaner_id: event.cleanerId || null,
    source: "payout-methods",
    summary: event.summary,
    data: payoutSafeRecord(event.data || {}),
  }).then(() => undefined, () => undefined);
}

async function deliver(db: DB, to: { email?: string | null; phone?: string | null; firstName?: string | null }, msg: ContractorMessage) {
  const email = String(to.email || "").trim();
  const phone = String(to.phone || "").trim();
  let emailed = false;
  let smsSent = false;
  if (email && !email.toLowerCase().endsWith("@pending.novara")) {
    const { error, data } = await db.functions.invoke("send-cleaner-email", {
      body: { type: "contractor_notice", email, data: { subject: msg.subject, html: msg.html } },
    });
    emailed = !error && !(data as { error?: string } | null)?.error;
  }
  if (phone) {
    const { error, data } = await db.functions.invoke("send-ghl-sms", {
      body: {
        phone,
        email: email || undefined,
        firstName: to.firstName || undefined,
        message: msg.sms,
        type: "payout_notice",
      },
    });
    smsSent = !error && !(data as { error?: string } | null)?.error;
  }
  return { emailed, smsSent };
}

export async function getPayoutSettings(db: DB): Promise<PayoutSettings> {
  return loadSettings(db);
}

export async function updatePayoutSettings(db: DB, patch: unknown, now = new Date().toISOString()) {
  const current = await loadSettings(db);
  const { settings, ledgerUpdates } = applySettingsChange(current, patch, now);
  await saveSettings(db, settings);
  await logEvent(db, { type: "payout.settings_updated", summary: "Payout method settings updated", data: { ledgerUpdates: ledgerUpdates.length } });
  return settings;
}

export async function resolveCleanerId(db: DB, userId: string, email: string): Promise<string | null> {
  const byUser = await from(db, "cleaners").select("id").eq("user_id", userId).maybeSingle();
  if (byUser.data?.id) return String(byUser.data.id);
  if (!email) return null;
  const byEmail = await from(db, "cleaners").select("id").ilike("email", email).maybeSingle();
  return byEmail.data?.id ? String(byEmail.data.id) : null;
}

function publicProfile(profile: Record<string, unknown> | null, settings: PayoutSettings, mask: boolean) {
  if (!profile) return null;
  const method = findMethod(settings, String(profile.method_code || ""));
  const identifier = String(profile.identifier || "");
  const pending = String(profile.pending_identifier || "");
  return {
    methodCode: profile.method_code || null,
    methodName: method?.displayName || profile.method_code || null,
    kind: method?.kind || null,
    status: profile.status || null,
    identifier: mask ? undefined : identifier || null,
    accountName: profile.account_name || null,
    changePending: Boolean(profile.change_pending),
    pendingMethodCode: profile.pending_method_code || null,
    pendingIdentifier: mask ? undefined : pending || null,
    pendingAccountName: profile.pending_account_name || null,
    confirmDetails: Boolean(profile.confirm_details),
    verifiedAt: profile.verified_at || null,
    acknowledgedAt: profile.acknowledged_at || null,
  };
}

export async function readContractorPayout(db: DB, cleanerId: string) {
  const settings = await loadSettings(db);
  const [{ data: cleaner }, { data: profile }, { data: changes }] = await Promise.all([
    from(db, "cleaners").select("id, first_name, last_name, email, phone, status, w9_status, payout_method_code, payout_method_status, payouts_enabled, ob_payouts_setup, stripe_account_id").eq("id", cleanerId).maybeSingle(),
    from(db, "contractor_payout_profiles").select("*").eq("cleaner_id", cleanerId).maybeSingle(),
    from(db, "contractor_payout_changes").select("id, old_method_code, new_method_code, old_identifier, new_identifier, old_account_name, new_account_name, changed_by_role, verification_channel, verified_at, created_at").eq("cleaner_id", cleanerId).order("created_at", { ascending: false }).limit(30),
  ]);
  if (!cleaner) throw new Error("Contractor not found.");
  const today = ymd();
  const stripeStarted = Boolean(cleaner.payouts_enabled || cleaner.ob_payouts_setup || cleaner.stripe_account_id);
  const visibleProfile = publicProfile(profile, settings, false) || (stripeStarted ? {
    methodCode: "stripe",
    methodName: "Stripe",
    kind: "stripe" as const,
    status: cleaner.payouts_enabled ? "verified" : "pending",
    identifier: null,
    accountName: null,
    changePending: false,
    pendingMethodCode: null,
    pendingIdentifier: null,
    pendingAccountName: null,
    confirmDetails: false,
    verifiedAt: null,
    acknowledgedAt: null,
  } : null);
  return {
    settings,
    methods: methodsForChoice(settings),
    acknowledgment: activeAcknowledgment(settings),
    nextPayRunDate: nextPayRunDate(settings.payRunWeekday, today),
    payRunWeekday: weekdayName(settings.payRunWeekday),
    profile: visibleProfile,
    changes: changes || [],
    w9OnFile: cleaner.w9_status === "complete",
    stripeStarted,
    cleaner: { id: cleaner.id, firstName: cleaner.first_name, lastName: cleaner.last_name, email: cleaner.email, phone: cleaner.phone, status: cleaner.status },
  };
}

async function sendCode(db: DB, cleaner: { first_name?: string | null; email?: string | null; phone?: string | null }, code: string) {
  const msg = verificationCodeNotice(String(cleaner.first_name || ""), code);
  const channel = cleaner.email ? "email" : cleaner.phone ? "phone" : null;
  const sent = await deliver(db, cleaner, msg);
  return { channel, ...sent };
}

export async function submitManualMethod(
  db: DB,
  cleanerId: string,
  input: {
    methodCode: string;
    identifier: string;
    identifierAgain: string;
    accountName: string;
    acknowledged: boolean;
    acknowledgmentText: string;
    actorId: string | null;
    actorRole: "contractor" | "admin";
  },
  now = new Date(),
) {
  const settings = await loadSettings(db);
  const method = findMethod(settings, input.methodCode);
  const ack = activeAcknowledgment(settings);
  const checked = validateManualSubmission({
    method,
    identifier: input.identifier,
    identifierAgain: input.identifierAgain,
    accountName: input.accountName,
    acknowledged: input.acknowledged,
    acknowledgmentText: input.acknowledgmentText,
    activeAcknowledgmentText: ack.text,
  });
  if (checked.ok === false) return { ok: false as const, error: checked.error };
  const preview = confirmationPreview({
    method: method!,
    identifier: checked.identifier,
    accountName: checked.accountName,
    settings,
  });
  const { data: cleaner, error: cleanerErr } = await from(db, "cleaners")
    .select("id, first_name, last_name, email, phone, stripe_account_id, ob_payouts_setup, payouts_enabled")
    .eq("id", cleanerId)
    .maybeSingle();
  if (cleanerErr || !cleaner) return { ok: false as const, error: "Contractor not found." };
  const { data: existing } = await from(db, "contractor_payout_profiles").select("*").eq("cleaner_id", cleanerId).maybeSingle();
  const issued = issueVerificationCode(now);
  let sent: { channel: string | null; emailed: boolean; smsSent: boolean } = { channel: null, emailed: false, smsSent: false };
  try {
    sent = await sendCode(db, cleaner, issued.code);
    await deliver(db, cleaner, detailChangeNotice(String(cleaner.first_name || "")));
    await deliver(db, { email: "operations@novaracleaning.com", firstName: "team" }, adminDetailChangeNotice(nameOf(cleaner)));
  } catch {
    /* The pending details still save. The contractor can ask for a new code. */
  }

  const pending = {
    pending_method_code: method!.code,
    pending_identifier: checked.identifier,
    pending_account_name: checked.accountName,
    pending_acknowledgment_version_id: ack.id,
    pending_acknowledgment_text: ack.text,
    pending_acknowledged_at: now.toISOString(),
    change_pending: true,
    details_changed_at: now.toISOString(),
    verification_salt: issued.salt,
    verification_code_hash: issued.hash,
    verification_expires_at: issued.expiresAt,
    verification_channel: sent.channel,
    confirm_details: false,
    updated_at: now.toISOString(),
  };
  const first = !existing || existing.status !== "verified" || !existing.identifier;
  const row = first
    ? {
        cleaner_id: cleanerId,
        method_code: method!.code,
        status: "pending",
        identifier: null,
        account_name: null,
        ...pending,
      }
    : { ...pending };
  const write = first
    ? from(db, "contractor_payout_profiles").upsert(row)
    : from(db, "contractor_payout_profiles").update(row).eq("cleaner_id", cleanerId);
  const { error } = await write;
  if (error) return { ok: false as const, error: error.message || "Could not save payout details." };

  await from(db, "contractor_payout_changes").insert({
    cleaner_id: cleanerId,
    old_method_code: existing?.method_code || null,
    new_method_code: method!.code,
    old_identifier: existing?.identifier || null,
    new_identifier: checked.identifier,
    old_account_name: existing?.account_name || null,
    new_account_name: checked.accountName,
    changed_by: input.actorId,
    changed_by_role: input.actorRole,
    verification_channel: sent.channel,
  });
  await from(db, "cleaners").update({ payout_method_code: method!.code, payout_method_status: first ? "pending" : existing.status }).eq("id", cleanerId);
  await logEvent(db, {
    type: "payout.details_submitted",
    cleanerId,
    summary: `${nameOf(cleaner)} submitted ${method!.displayName} payout details`,
    data: { methodCode: method!.code, channel: sent.channel },
  });
  return {
    ok: true as const,
    preview,
    status: first ? "pending" : existing.status,
    changePending: true,
    emailed: sent.emailed,
    smsSent: sent.smsSent,
    stripeKept: {
      stripe_account_id: cleaner.stripe_account_id || null,
      ob_payouts_setup: Boolean(cleaner.ob_payouts_setup),
      payouts_enabled: Boolean(cleaner.payouts_enabled),
    },
  };
}

export async function confirmPayoutCode(db: DB, cleanerId: string, code: string, now = new Date()) {
  const { data: profile } = await from(db, "contractor_payout_profiles").select("*").eq("cleaner_id", cleanerId).maybeSingle();
  if (!profile?.verification_code_hash || !profile.verification_salt || !profile.pending_identifier) {
    return { ok: false as const, error: "There is no payout change waiting for a code." };
  }
  const matches = verificationCodeMatches({
    code,
    salt: String(profile.verification_salt),
    hash: String(profile.verification_code_hash),
    expiresAt: String(profile.verification_expires_at || ""),
    now,
  });
  if (!matches) return { ok: false as const, error: "That code is wrong or expired. Request a new one." };
  const methodCode = String(profile.pending_method_code || profile.method_code);
  const patch = cleanerPatchForVerifiedManual(methodCode);
  const { error } = await from(db, "contractor_payout_profiles").update({
    method_code: methodCode,
    status: "verified",
    identifier: profile.pending_identifier,
    account_name: profile.pending_account_name,
    acknowledgment_version_id: profile.pending_acknowledgment_version_id,
    acknowledgment_text: profile.pending_acknowledgment_text,
    acknowledged_at: profile.pending_acknowledged_at,
    verified_at: now.toISOString(),
    change_pending: false,
    pending_method_code: null,
    pending_identifier: null,
    pending_account_name: null,
    pending_acknowledgment_version_id: null,
    pending_acknowledgment_text: null,
    pending_acknowledged_at: null,
    verification_salt: null,
    verification_code_hash: null,
    verification_expires_at: null,
    confirm_details: false,
    updated_at: now.toISOString(),
  }).eq("cleaner_id", cleanerId);
  if (error) return { ok: false as const, error: error.message || "Could not confirm payout details." };
  await from(db, "cleaners").update(patch).eq("id", cleanerId);
  await from(db, "contractor_payout_changes")
    .update({ verified_at: now.toISOString() })
    .eq("cleaner_id", cleanerId)
    .is("verified_at", null);
  await logEvent(db, {
    type: "payout.details_verified",
    cleanerId,
    summary: "Payout details confirmed with a code",
    data: { methodCode, channel: profile.verification_channel },
  });
  return { ok: true as const, methodCode, status: "verified" as const };
}

export async function resendPayoutCode(db: DB, cleanerId: string, now = new Date()) {
  const { data: cleaner } = await from(db, "cleaners").select("id, first_name, email, phone").eq("id", cleanerId).maybeSingle();
  const { data: profile } = await from(db, "contractor_payout_profiles").select("change_pending").eq("cleaner_id", cleanerId).maybeSingle();
  if (!cleaner || !profile?.change_pending) return { ok: false as const, error: "There is no payout change waiting for a code." };
  const issued = issueVerificationCode(now);
  const sent = await sendCode(db, cleaner, issued.code);
  await from(db, "contractor_payout_profiles").update({
    verification_salt: issued.salt,
    verification_code_hash: issued.hash,
    verification_expires_at: issued.expiresAt,
    verification_channel: sent.channel,
    updated_at: now.toISOString(),
  }).eq("cleaner_id", cleanerId);
  return { ok: true as const, ...sent };
}

async function loadDraft(db: DB, settings: PayoutSettings, payRunAt: string) {
  const [{ data: cleaners }, { data: profiles }, { data: w9s }, { data: payouts }, { data: extras }, { data: adjustments }, { data: claims }, { data: paidLines }] = await Promise.all([
    from(db, "cleaners").select("id, first_name, last_name, status, w9_status, payout_method_code, payout_method_status, payouts_enabled, ob_payouts_setup, stripe_account_id"),
    from(db, "contractor_payout_profiles").select("cleaner_id, method_code, status, identifier, account_name, details_changed_at, confirm_details"),
    from(db, "cleaner_w9").select("cleaner_id, legal_name, validated_at"),
    from(db, "manual_payouts").select("id, cleaner_id, amount_cents, service_date, booking_id, status, created_at").eq("status", "pending"),
    from(db, "job_extra_pay").select("id, cleaner_id, total_cents, status, created_at, booking_id, stripe_transfer_id").eq("status", "pending"),
    from(db, "payout_adjustments").select("id, cleaner_id, amount_cents, reason, section, status, created_at").eq("status", "open"),
    from(db, "pay_run_earning_claims").select("earning_id"),
    from(db, "pay_run_lines").select("cleaner_id, identifier, status").eq("status", "paid"),
  ]);
  const profileBy = new Map<string, Record<string, unknown>>();
  for (const row of profiles || []) profileBy.set(String(row.cleaner_id), row);
  const w9By = new Map<string, string>();
  for (const row of w9s || []) {
    if (row.validated_at) w9By.set(String(row.cleaner_id), String(row.legal_name || ""));
  }
  const priorBy = new Map<string, string[]>();
  for (const row of paidLines || []) {
    const id = String(row.identifier || "").trim().toLowerCase();
    if (!id) continue;
    const list = priorBy.get(String(row.cleaner_id)) || [];
    list.push(id);
    priorBy.set(String(row.cleaner_id), list);
  }
  const contractors: PayContractor[] = (cleaners || []).map((cleaner: Record<string, unknown>) => {
    const profile = profileBy.get(String(cleaner.id));
    const stripe = Boolean(cleaner.payouts_enabled || cleaner.ob_payouts_setup || cleaner.stripe_account_id);
    const code = String(profile?.method_code || cleaner.payout_method_code || (stripe ? "stripe" : "") || "") || null;
    const method = findMethod(settings, code);
    const rawStatus = String(profile?.status || cleaner.payout_method_status || "");
    let methodStatus: PayContractor["methodStatus"] = "none";
    if (rawStatus === "verified" || rawStatus === "pending" || rawStatus === "on_hold") methodStatus = rawStatus;
    else if (method?.kind === "stripe" && stripe) methodStatus = "verified";
    return {
      cleanerId: String(cleaner.id),
      name: nameOf(cleaner as { first_name?: string | null; last_name?: string | null }),
      methodCode: code,
      methodKind: method?.kind || (code === "stripe" ? "stripe" : null),
      methodStatus,
      identifier: methodStatus === "verified" ? String(profile?.identifier || "") || null : null,
      accountName: (profile?.account_name as string) || null,
      w9OnFile: cleaner.w9_status === "complete",
      w9LegalName: w9By.get(String(cleaner.id)) || null,
      engagementStatus: String(cleaner.status || ""),
      detailsChangedAt: (profile?.details_changed_at as string) || null,
      confirmDetails: Boolean(profile?.confirm_details),
      priorPaidIdentifiers: priorBy.get(String(cleaner.id)) || [],
    };
  });
  const bookingIds = [...new Set([...(payouts || []), ...(extras || [])].map((row: { booking_id?: string | null }) => row.booking_id).filter(Boolean))] as string[];
  const jobByBooking = new Map<string, { jobId: string | null; jobDate: string | null }>();
  if (bookingIds.length) {
    const { data: bookings } = await from(db, "bookings").select("id, job_id, service_date").in("id", bookingIds);
    for (const booking of bookings || []) {
      jobByBooking.set(String(booking.id), { jobId: booking.job_id ? String(booking.job_id) : null, jobDate: booking.service_date || null });
    }
  }
  const earnings: PayEarning[] = [];
  for (const row of payouts || []) {
    const job = row.booking_id ? jobByBooking.get(String(row.booking_id)) : undefined;
    earnings.push({
      id: `manual:${row.id}`,
      cleanerId: String(row.cleaner_id),
      amountCents: Math.round(Number(row.amount_cents) || 0),
      jobId: job?.jobId || (row.booking_id ? String(row.booking_id) : null),
      jobDate: row.service_date || job?.jobDate || null,
      kind: "job",
      reason: null,
      section: null,
      status: "approved",
      qcCleared: true,
      approvedAt: row.created_at || null,
    });
  }
  for (const row of extras || []) {
    if (row.stripe_transfer_id) continue;
    const job = row.booking_id ? jobByBooking.get(String(row.booking_id)) : undefined;
    earnings.push({
      id: `extra:${row.id}`,
      cleanerId: String(row.cleaner_id),
      amountCents: Math.round(Number(row.total_cents) || 0),
      jobId: job?.jobId || (row.booking_id ? String(row.booking_id) : null),
      jobDate: job?.jobDate || null,
      kind: "extra",
      reason: null,
      section: null,
      status: "approved",
      qcCleared: true,
      approvedAt: row.created_at || null,
    });
  }
  for (const row of adjustments || []) {
    earnings.push({
      id: `adjust:${row.id}`,
      cleanerId: String(row.cleaner_id),
      amountCents: Math.round(Number(row.amount_cents) || 0),
      jobId: null,
      jobDate: null,
      kind: "adjustment",
      reason: row.reason || null,
      section: row.section || null,
      status: "approved",
      qcCleared: true,
      approvedAt: row.created_at || null,
    });
  }
  return {
    contractors,
    earnings,
    claimedEarningIds: (claims || []).map((row: { earning_id: string }) => String(row.earning_id)),
    payRunAt,
    holdHours: settings.changeHoldHours,
    aged: agedEarnings(earnings, settings.agingDays, payRunAt),
  };
}

function lineToDb(runId: string, line: PayLine) {
  return {
    pay_run_id: runId,
    cleaner_id: line.cleanerId,
    method_code: line.methodCode,
    identifier: line.identifier,
    account_name: line.accountName,
    gross_cents: line.grossCents,
    deduction_cents: line.deductionCents,
    amount_due_cents: line.amountDueCents,
    status: "open",
    flags: line.flags,
    w9_legal_name: line.w9LegalName,
  };
}

export async function refreshPayRun(db: DB, actorId: string, opts?: { offCycle?: boolean; now?: Date }) {
  const now = opts?.now || new Date();
  const settings = await loadSettings(db);
  const today = ymd(now);
  const scheduled = nextPayRunDate(settings.payRunWeekday, today);
  const { data: openRun } = await from(db, "pay_runs").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(1).maybeSingle();
  let run = openRun;
  if (!run) {
    const created = await from(db, "pay_runs").insert({
      status: "open",
      scheduled_for: scheduled,
      off_cycle: Boolean(opts?.offCycle) && scheduled !== today,
      created_by: actorId,
    }).select("*").single();
    if (created.error) throw new Error(created.error.message || "Could not create the pay run.");
    run = created.data;
  }
  const draft = await loadDraft(db, settings, now.toISOString());
  const assembled = assemblePayRun(draft);
  const { data: openLines } = await from(db, "pay_run_lines").select("id").eq("pay_run_id", run.id).eq("status", "open");
  const openIds = (openLines || []).map((row: { id: string }) => row.id);
  if (openIds.length) {
    await from(db, "pay_run_earning_claims").delete().in("pay_run_line_id", openIds);
    await from(db, "pay_run_line_earnings").delete().in("pay_run_line_id", openIds);
    await from(db, "pay_run_lines").delete().in("id", openIds);
  }
  const savedLines = [];
  for (const line of assembled.lines) {
    const inserted = await from(db, "pay_run_lines").insert(lineToDb(run.id, line)).select("*").single();
    if (inserted.error) throw new Error(inserted.error.message || "Could not save a pay run line.");
    const saved = inserted.data;
    savedLines.push({ ...saved, contractor_name: line.contractorName, earnings: line.earnings });
    if (line.earnings.length) {
      await from(db, "pay_run_line_earnings").insert(line.earnings.map((earning) => ({
        pay_run_line_id: saved.id,
        earning_id: earning.id,
        amount_cents: earning.amountCents,
        job_id: earning.jobId,
        job_date: earning.jobDate,
        kind: earning.kind,
        reason: earning.reason,
        section: earning.section,
      })));
      await from(db, "pay_run_earning_claims").insert(line.earnings.map((earning) => ({
        earning_id: earning.id,
        pay_run_line_id: saved.id,
        state: "open",
      })));
    }
  }
  const oldest = draft.aged.reduce((max, row) => {
    const days = row.approvedAt ? (now.getTime() - Date.parse(row.approvedAt)) / 86_400_000 : 0;
    return Math.max(max, Math.floor(days));
  }, 0);
  return {
    run,
    lines: savedLines,
    cannotPay: assembled.cannotPay,
    groups: assembled.groups.map((group) => ({
      methodCode: group.methodCode,
      lines: savedLines.filter((line) => line.method_code === group.methodCode),
    })),
    reminder: today === scheduled ? payRunDayReminder(weekdayName(settings.payRunWeekday)) : null,
    aging: agingAlert(draft.aged.length, Math.max(oldest, settings.agingDays)),
    agedCount: draft.aged.length,
    settings,
  };
}

async function loadLine(db: DB, lineId: string) {
  const { data: line, error } = await from(db, "pay_run_lines").select("*").eq("id", lineId).maybeSingle();
  if (error) throw new Error(error.message || "Could not read the pay run line.");
  if (!line) return null;
  const { data: earnings } = await from(db, "pay_run_line_earnings").select("*").eq("pay_run_line_id", lineId);
  return { line, earnings: earnings || [] };
}

function asPayLine(line: Record<string, unknown>, earnings: Record<string, unknown>[]): PayLine {
  const flags = Array.isArray(line.flags) ? line.flags.map(String) : [];
  return {
    key: `${line.method_code}:${line.cleaner_id}`,
    cleanerId: String(line.cleaner_id),
    contractorName: "",
    methodCode: String(line.method_code),
    identifier: String(line.identifier || ""),
    accountName: (line.account_name as string) || null,
    w9LegalName: (line.w9_legal_name as string) || null,
    grossCents: Number(line.gross_cents) || 0,
    deductionCents: Number(line.deduction_cents) || 0,
    amountDueCents: Number(line.amount_due_cents) || 0,
    earnings: earnings.map((row) => ({
      id: String(row.earning_id),
      amountCents: Number(row.amount_cents) || 0,
      jobId: (row.job_id as string) || null,
      jobDate: (row.job_date as string) || null,
      kind: (row.kind as "job" | "extra" | "adjustment") || "job",
      reason: (row.reason as string) || null,
      section: (row.section as string) || null,
    })),
    flags: flags as PayLine["flags"],
    recentChangeHold: flags.includes("recent_change_hold"),
    firstPayment: flags.includes("first_payment"),
  };
}

export async function markPayRunLinePaid(
  db: DB,
  lineId: string,
  actorId: string,
  input: {
    amountSentCents?: number;
    recipientName?: string | null;
    mismatchNote?: string | null;
    differenceReason?: string | null;
    confirmationRef?: string | null;
    screenshotPath?: string | null;
    holdReleased?: boolean;
  },
  now = new Date(),
) {
  const loaded = await loadLine(db, lineId);
  if (!loaded) return { ok: false as const, error: "Pay run line not found." };
  const { line, earnings } = loaded;
  if (line.status === "paid" && line.ledger_ref) {
    return { ok: true as const, alreadyPaid: true, ledgerId: line.ledger_ref };
  }
  if (line.status !== "open" && line.status !== "reopened") {
    return { ok: false as const, error: "This line is not open." };
  }
  const { data: cleaner } = await from(db, "cleaners").select("id, first_name, email, phone, w9_status").eq("id", line.cleaner_id).maybeSingle();
  const settings = await loadSettings(db);
  const method = findMethod(settings, String(line.method_code));
  const payLine = asPayLine(line, earnings);
  const decision = applyPaid(payLine, {
    now: now.toISOString(),
    actorId,
    amountSentCents: input.amountSentCents ?? payLine.amountDueCents,
    recipientName: input.recipientName || null,
    mismatchNote: input.mismatchNote || null,
    differenceReason: input.differenceReason || null,
    confirmationRef: input.confirmationRef || null,
    holdReleased: Boolean(input.holdReleased || line.hold_released_at),
    w9OnFile: cleaner?.w9_status === "complete",
    countsTowardOwn1099: snapshot1099Flag(method),
    existingLedgerId: line.ledger_ref || null,
    alreadyPaid: false,
  });
  if (!decision.ok) {
    await from(db, "pay_run_lines").update({
      flags: decision.flags,
      recipient_name_displayed: input.recipientName || line.recipient_name_displayed,
      updated_at: now.toISOString(),
    }).eq("id", lineId);
    return decision;
  }
  const shares = allocateSentCents(
    payLine.earnings.filter((row) => row.amountCents > 0).map((row) => ({ id: row.id, amountCents: row.amountCents })),
    decision.ledger.amountCents,
  );
  const shareBy = new Map(shares.map((share) => [share.id, share.amountCents]));
  for (const earning of payLine.earnings) {
    const sent = shareBy.get(earning.id);
    if (earning.id.startsWith("manual:")) {
      await from(db, "manual_payouts").update({
        status: "paid",
        paid_at: now.toISOString(),
        updated_at: now.toISOString(),
        payout_method_code: line.method_code,
        counts_toward_own_1099: decision.ledger.countsTowardOwn1099,
        amount_sent_cents: sent ?? earning.amountCents,
        recorded_by: actorId,
        confirmation_ref: decision.ledger.reference,
        recipient_name_displayed: decision.ledger.recipientName,
        difference_reason: decision.ledger.differenceReason,
        pay_run_line_id: lineId,
      }).eq("id", earning.id.slice("manual:".length)).eq("status", "pending");
    } else if (earning.id.startsWith("extra:")) {
      await from(db, "job_extra_pay").update({
        status: "paid",
        paid_at: now.toISOString(),
        payout_method_code: line.method_code,
        counts_toward_own_1099: decision.ledger.countsTowardOwn1099,
      }).eq("id", earning.id.slice("extra:".length));
    } else if (earning.id.startsWith("adjust:")) {
      await from(db, "payout_adjustments").update({
        status: "applied",
        pay_run_line_id: lineId,
      }).eq("id", earning.id.slice("adjust:".length));
    }
  }
  await from(db, "pay_run_earning_claims").update({ state: "paid" }).eq("pay_run_line_id", lineId);
  await from(db, "pay_run_lines").update({
    status: "paid",
    amount_sent_cents: decision.ledger.amountCents,
    difference_reason: decision.ledger.differenceReason,
    flags: decision.flags,
    recipient_name_displayed: decision.ledger.recipientName,
    name_mismatch_note: input.mismatchNote || null,
    confirmation_ref: decision.ledger.reference,
    screenshot_path: input.screenshotPath || null,
    paid_at: now.toISOString(),
    paid_by: actorId,
    ledger_ref: decision.ledger.id,
    hold_released_at: input.holdReleased ? now.toISOString() : line.hold_released_at,
    hold_released_by: input.holdReleased ? actorId : line.hold_released_by,
    updated_at: now.toISOString(),
  }).eq("id", lineId);
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://contractor.novaracleaning.com";
  const notice = paidNotice({
    firstName: String(cleaner?.first_name || ""),
    amountCents: decision.ledger.amountCents,
    methodName: method?.displayName || String(line.method_code),
    paidOn: ymd(now),
    jobs: payLine.earnings.filter((row) => row.kind !== "adjustment").map((row) => ({ jobId: row.jobId, jobDate: row.jobDate })),
    summaryUrl: `${origin}/cleaner/payment-summary/${lineId}`,
  });
  if (cleaner) await deliver(db, cleaner, notice);
  await logEvent(db, {
    type: "payout.marked_paid",
    cleanerId: String(line.cleaner_id),
    summary: `Marked a ${method?.displayName || line.method_code} payout paid`,
    data: { lineId, ledgerId: decision.ledger.id, amountCents: decision.ledger.amountCents, created: decision.ledger.created },
  });
  return { ok: true as const, alreadyPaid: false, ledgerId: decision.ledger.id, created: decision.ledger.created };
}

export async function failPayRunLine(db: DB, lineId: string, reason: string, actorId: string, now = new Date()) {
  const loaded = await loadLine(db, lineId);
  if (!loaded) return { ok: false as const, error: "Pay run line not found." };
  if (loaded.line.status === "paid") return { ok: false as const, error: "A paid line has to be reopened before it can be failed." };
  const decision = applyFailed(asPayLine(loaded.line, loaded.earnings), { reason });
  if (!decision.ok) return decision;
  if (decision.releasedEarningIds.length) {
    await from(db, "pay_run_earning_claims").delete().in("earning_id", decision.releasedEarningIds);
  }
  await from(db, "pay_run_lines").update({
    status: "failed",
    failure_reason: decision.reason,
    updated_at: now.toISOString(),
  }).eq("id", lineId);
  await from(db, "contractor_payout_profiles").update({ confirm_details: true, updated_at: now.toISOString() }).eq("cleaner_id", loaded.line.cleaner_id);
  const { data: cleaner } = await from(db, "cleaners").select("first_name, email, phone").eq("id", loaded.line.cleaner_id).maybeSingle();
  if (cleaner) await deliver(db, cleaner, paymentFailedNotice(String(cleaner.first_name || "")));
  await logEvent(db, {
    type: "payout.marked_failed",
    cleanerId: String(loaded.line.cleaner_id),
    summary: "A pay run line failed and the earnings returned to unpaid",
    data: { lineId, by: actorId },
  });
  return { ok: true as const, releasedEarningIds: decision.releasedEarningIds };
}

export async function reopenPayRunLine(db: DB, lineId: string, reason: string, actorId: string, now = new Date()) {
  const loaded = await loadLine(db, lineId);
  if (!loaded) return { ok: false as const, error: "Pay run line not found." };
  const decision = reopenPaid({ reason, alreadyPaid: loaded.line.status === "paid" });
  if (!decision.ok) return decision;
  await from(db, "pay_run_lines").update({
    status: "reopened",
    reopen_reason: decision.reason,
    updated_at: now.toISOString(),
  }).eq("id", lineId);
  await logEvent(db, {
    type: "payout.reopened",
    cleanerId: String(loaded.line.cleaner_id),
    summary: "A paid line was reopened",
    data: { lineId, by: actorId, reason: decision.reason },
  });
  return { ok: true as const };
}

export async function releasePayRunHold(db: DB, lineId: string, actorId: string, now = new Date()) {
  const { error } = await from(db, "pay_run_lines").update({
    hold_released_at: now.toISOString(),
    hold_released_by: actorId,
    updated_at: now.toISOString(),
  }).eq("id", lineId);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function closePayRun(db: DB, runId: string, actorId: string, now = new Date()) {
  const { data: lines } = await from(db, "pay_run_lines").select("method_code, status, amount_due_cents, amount_sent_cents").eq("pay_run_id", runId);
  const byMethod: Record<string, { count: number; dueCents: number; sentCents: number }> = {};
  for (const line of lines || []) {
    const bucket = byMethod[line.method_code] || { count: 0, dueCents: 0, sentCents: 0 };
    bucket.count += 1;
    bucket.dueCents += Number(line.amount_due_cents) || 0;
    bucket.sentCents += Number(line.amount_sent_cents) || 0;
    byMethod[line.method_code] = bucket;
  }
  const summary = {
    byMethod,
    lineCount: (lines || []).length,
    paidCount: (lines || []).filter((line: { status: string }) => line.status === "paid").length,
    closedBy: actorId,
    closedAt: now.toISOString(),
  };
  const { error } = await from(db, "pay_runs").update({
    status: "closed",
    closed_by: actorId,
    closed_at: now.toISOString(),
    summary,
  }).eq("id", runId).eq("status", "open");
  if (error) return { ok: false as const, error: error.message };
  await logEvent(db, { type: "payout.run_closed", summary: "Pay run closed", data: { runId, lineCount: summary.lineCount } });
  return { ok: true as const, summary };
}

export async function recordOverpayment(
  db: DB,
  input: { cleanerId: string; amountCents: number; reason: string; actorId: string },
) {
  const reason = input.reason.trim();
  const amount = Math.round(input.amountCents);
  if (!input.cleanerId) return { ok: false as const, error: "Choose a contractor." };
  if (!reason) return { ok: false as const, error: "An overpayment correction needs a reason." };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false as const, error: "Enter the amount to deduct." };
  const { data, error } = await from(db, "payout_adjustments").insert({
    cleaner_id: input.cleanerId,
    amount_cents: amount,
    reason,
    section: "7.9",
    created_by: input.actorId,
  }).select("id").single();
  if (error) return { ok: false as const, error: error.message };
  await logEvent(db, {
    type: "payout.overpayment_correction",
    cleanerId: input.cleanerId,
    summary: "Recorded an overpayment correction for the next pay run",
    data: { adjustmentId: data.id, amountCents: amount, section: "7.9" },
  });
  return { ok: true as const, id: data.id as string };
}

/** Explicit classification of rows that were paid before a flag existed. Settings saves do not call this. */
export async function classifyUnclassifiedPayouts(db: DB, methodCode: string, include: boolean, actorId: string) {
  const flag = include === true;
  const payouts = await from(db, "manual_payouts")
    .update({ counts_toward_own_1099: flag })
    .eq("payout_method_code", methodCode)
    .is("counts_toward_own_1099", null)
    .select("id");
  const extras = await from(db, "job_extra_pay")
    .update({ counts_toward_own_1099: flag })
    .eq("payout_method_code", methodCode)
    .is("counts_toward_own_1099", null)
    .select("id");
  if (payouts.error) return { ok: false as const, error: payouts.error.message };
  if (extras.error) return { ok: false as const, error: extras.error.message };
  await logEvent(db, {
    type: "payout.1099_classified",
    summary: `Classified unclassified ${methodCode} payouts for 1099`,
    data: { methodCode, include: flag, by: actorId, payouts: (payouts.data || []).length, extras: (extras.data || []).length },
  });
  return { ok: true as const, payouts: (payouts.data || []).length, extras: (extras.data || []).length };
}

export async function setPayoutHold(db: DB, cleanerId: string, hold: boolean, actorId: string) {
  const { error } = await from(db, "contractor_payout_profiles").update({
    status: hold ? "on_hold" : "verified",
    updated_at: new Date().toISOString(),
  }).eq("cleaner_id", cleanerId);
  if (error) return { ok: false as const, error: error.message };
  await from(db, "cleaners").update({ payout_method_status: hold ? "on_hold" : "verified" }).eq("id", cleanerId);
  await logEvent(db, {
    type: hold ? "payout.held" : "payout.hold_cleared",
    cleanerId,
    summary: hold ? "Payout method placed on hold" : "Payout hold cleared",
    data: { by: actorId },
  });
  return { ok: true as const };
}

export async function payoutAdminReport(db: DB) {
  const settings = await loadSettings(db);
  const { data: cleaners } = await from(db, "cleaners").select("id, first_name, last_name, status, w9_status, payout_method_code, payout_method_status, payouts_enabled, ob_payouts_setup, stripe_account_id, ob_agreement_signed, phone_verified, supply_checklist_submitted_at, ob_supplies_checklist_viewed, ob_dress_code_ack, ob_job_day_guides_ack, ob_training_complete, completed_bookings");
  const rows = (cleaners || []).map((cleaner: Record<string, unknown>) => {
    const state: CleanerSetupState = {
      ob_agreement_signed: Boolean(cleaner.ob_agreement_signed),
      phone_verified: Boolean(cleaner.phone_verified),
      supply_checklist_submitted_at: (cleaner.supply_checklist_submitted_at as string) || null,
      ob_supplies_checklist_viewed: Boolean(cleaner.ob_supplies_checklist_viewed),
      ob_dress_code_ack: Boolean(cleaner.ob_dress_code_ack),
      ob_job_day_guides_ack: Boolean(cleaner.ob_job_day_guides_ack),
      ob_training_complete: Boolean(cleaner.ob_training_complete),
      w9_status: (cleaner.w9_status as string) || null,
      payouts_enabled: Boolean(cleaner.payouts_enabled),
      ob_payouts_setup: Boolean(cleaner.ob_payouts_setup),
      stripe_account_id: (cleaner.stripe_account_id as string) || null,
      payout_method_status: (cleaner.payout_method_status as string) || null,
      completed_bookings: Number(cleaner.completed_bookings) || 0,
    };
    const stripe = Boolean(cleaner.payouts_enabled || cleaner.ob_payouts_setup || cleaner.stripe_account_id);
    return {
      name: nameOf(cleaner as { first_name?: string | null; last_name?: string | null }),
      methodCode: (cleaner.payout_method_code as string) || (stripe ? "stripe" : null),
      methodStatus: (cleaner.payout_method_status as string) || (stripe ? "verified" : null),
      stalledAtPayout: cleaner.status !== "terminated" && cleaner.status !== "resigned" && isStalledAtPayoutStep(state),
    };
  });
  return { settings, report: payoutMethodReport(rows) };
}

export async function monthlyPayoutReport(db: DB, month: string) {
  const start = `${month.slice(0, 7)}-01`;
  const { data } = await from(db, "manual_payouts")
    .select("payout_method_code, amount_sent_cents, amount_cents, paid_at, status")
    .eq("status", "paid")
    .gte("paid_at", start);
  const rows = (data || []).map((row: Record<string, unknown>) => ({
    methodCode: (row.payout_method_code as string) || null,
    amountCents: row.amount_sent_cents != null ? Number(row.amount_sent_cents) : Number(row.amount_cents) || 0,
    paidAt: (row.paid_at as string) || null,
  }));
  return { month: month.slice(0, 7), totals: monthlyTotalsByMethod(rows, month) };
}

export async function stripeOptionsOutreach(db: DB, input: { cleanerId: string; actorId: string; approved: boolean; now?: Date }) {
  const { data: prior } = await from(db, "payout_outreach").select("id").eq("cleaner_id", input.cleanerId).eq("kind", "stripe_options").maybeSingle();
  const gate = canSendExistingOptionsNotice(Boolean(prior), input.approved);
  const { data: cleaner } = await from(db, "cleaners").select("id, first_name, email, phone, payouts_enabled, stripe_account_id, ob_payouts_setup, payout_method_status").eq("id", input.cleanerId).maybeSingle();
  if (!cleaner) return { ok: false as const, error: "Contractor not found." };
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://contractor.novaracleaning.com";
  const notice = existingStripeOptionsNotice(String(cleaner.first_name || ""), `${origin}/cleaner/profile`);
  if (gate.ok === false) return { ok: false as const, error: gate.error, draft: { subject: notice.subject, text: notice.text } };
  const sent = await deliver(db, cleaner, notice);
  await from(db, "payout_outreach").insert({ cleaner_id: input.cleanerId, kind: "stripe_options", sent_by: input.actorId });
  await logEvent(db, {
    type: "payout.options_notice_sent",
    cleanerId: input.cleanerId,
    summary: "Admin sent the one-time payout options note",
    data: { by: input.actorId },
  });
  return { ok: true as const, ...sent, draft: { subject: notice.subject, text: notice.text } };
}

export async function draftStripeOptionsNotice(db: DB, cleanerId: string) {
  const { data: cleaner } = await from(db, "cleaners").select("first_name").eq("id", cleanerId).maybeSingle();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://contractor.novaracleaning.com";
  const notice = existingStripeOptionsNotice(String(cleaner?.first_name || ""), `${origin}/cleaner/profile`);
  const { data: prior } = await from(db, "payout_outreach").select("sent_at").eq("cleaner_id", cleanerId).eq("kind", "stripe_options").maybeSingle();
  return { subject: notice.subject, text: notice.text, alreadySent: Boolean(prior), sentAt: prior?.sent_at || null };
}

export async function sendDueReminders(db: DB, now = new Date()) {
  const settings = await loadSettings(db);
  const { data: cleaners } = await from(db, "cleaners")
    .select("id, first_name, email, phone, status, w9_status, payout_method_status")
    .in("status", ["active", "pending"]);
  const { data: reminders } = await from(db, "payout_reminders").select("cleaner_id, kind, sent_at");
  const last = new Map<string, string>();
  for (const row of reminders || []) last.set(`${row.cleaner_id}:${row.kind}`, row.sent_at);
  let sent = 0;
  for (const cleaner of cleaners || []) {
    const missing: Array<"method" | "w9"> = [];
    if (cleaner.payout_method_status !== "verified") missing.push("method");
    if (cleaner.w9_status !== "complete") missing.push("w9");
    if (!missing.length) continue;
    const kind = missing.slice().sort().join("+");
    if (!reminderIsDue(last.get(`${cleaner.id}:${kind}`) || null, settings.reminderIntervalDays, now.toISOString())) continue;
    const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://contractor.novaracleaning.com";
    await deliver(db, cleaner, missingSetupReminder(String(cleaner.first_name || ""), missing, `${origin}/cleaner/ob-portal`));
    await from(db, "payout_reminders").upsert({ cleaner_id: cleaner.id, kind, sent_at: now.toISOString() });
    sent += 1;
  }
  return { ok: true as const, sent };
}

export async function paymentSummaryFor(db: DB, lineId: string, cleanerId: string | null) {
  const loaded = await loadLine(db, lineId);
  if (!loaded) return null;
  if (cleanerId && String(loaded.line.cleaner_id) !== cleanerId) return null;
  if (loaded.line.status !== "paid" && loaded.line.status !== "reopened") return null;
  const { data: cleaner } = await from(db, "cleaners").select("first_name, last_name").eq("id", loaded.line.cleaner_id).maybeSingle();
  const settings = await loadSettings(db);
  const method = findMethod(settings, String(loaded.line.method_code));
  const jobs = loaded.earnings
    .filter((row: { kind: string }) => row.kind !== "adjustment")
    .map((row: { job_id?: string; job_date?: string; amount_cents?: number }) => ({
      jobId: row.job_id || null,
      jobDate: row.job_date || null,
      grossCents: Math.max(0, Number(row.amount_cents) || 0),
    }));
  const adjustments = loaded.earnings
    .filter((row: { kind: string }) => row.kind === "adjustment")
    .map((row: { reason?: string; amount_cents?: number; section?: string }) => ({
      reason: row.reason || "Adjustment",
      amountCents: Math.abs(Number(row.amount_cents) || 0),
      section: row.section || null,
    }));
  return buildPaymentSummary({
    contractorName: nameOf(cleaner || {}),
    methodName: method?.displayName || String(loaded.line.method_code),
    paidOn: String(loaded.line.paid_at || "").slice(0, 10),
    jobs,
    adjustments,
    netCents: Number(loaded.line.amount_sent_cents ?? loaded.line.amount_due_cents) || 0,
  });
}

export async function listContractorPayoutAdmin(db: DB, cleanerId: string) {
  const state = await readContractorPayout(db, cleanerId);
  const { data: payouts } = await from(db, "manual_payouts")
    .select("id, amount_cents, amount_sent_cents, status, paid_at, payout_method_code, service_date")
    .eq("cleaner_id", cleanerId)
    .order("created_at", { ascending: false })
    .limit(8);
  return {
    ...state,
    lastPayment: (payouts || []).find((row: { status: string }) => row.status === "paid") || null,
    recentPayments: payouts || [],
  };
}
