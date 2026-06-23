// Shared turnover engine: assignment, notifications, and batch finalize.
// Used by partner-turnover (host actions) and partner-recurring-generate
// (weekly cron) so the assignment + notification logic lives in ONE place.

import { resolveSecret } from "./app-secrets.ts";
import { sendSms, formatServiceDate } from "./sms.ts";
import { notifyDiscord } from "./discord.ts";

// deno-lint-ignore no-explicit-any
export type SB = any;

// Cleaner's share of a turnover used in the assignment SMS (informational).
export const CLEANER_SHARE = 0.70;
export const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

export function fmtWindow(start?: string | null, end?: string | null): string {
  const t = (s?: string | null) => {
    if (!s) return "";
    const [h, m] = s.split(":");
    const hh = parseInt(h, 10);
    const ap = hh >= 12 ? "PM" : "AM";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${m ?? "00"} ${ap}`;
  };
  const a = t(start), b = t(end);
  if (a && b) return `${a} - ${b}`;
  return a || b || "";
}

// Fire a branded host/cleaner email (best-effort).
export async function sendPartnerEmail(admin: SB, type: string, email: string | null | undefined, data: Record<string, unknown>) {
  if (!email) return;
  try {
    await admin.functions.invoke("send-partner-email", { body: { type, email, data } });
  } catch (e) {
    console.warn("[turnover-engine] email failed", type, e instanceof Error ? e.message : String(e));
  }
}

export async function loadContext(admin: SB, tr: Record<string, unknown>) {
  const { data: property } = await admin.from("properties").select("*").eq("id", tr.property_id).maybeSingle();
  const { data: hostRow } = await admin.from("hosts").select("*").eq("id", tr.host_id).maybeSingle();
  return { property, hostRow };
}

export async function notifyAssignment(admin: SB, tr: Record<string, unknown>) {
  const { property, hostRow } = await loadContext(admin, tr);
  const cleanerId = tr.assigned_cleaner_id as string | null;
  if (!cleanerId) return;
  const { data: cleaner } = await admin.from("cleaners").select("first_name, phone, email").eq("id", cleanerId).maybeSingle();
  const dateLabel = formatServiceDate(tr.requested_date as string);
  const windowLabel = fmtWindow(tr.window_start as string, tr.window_end as string);
  const priceNum = Number(tr.price || 0);
  const share = money(priceNum * CLEANER_SHARE);
  const nickname = property?.nickname || property?.address || "Property";
  const assignmentType = (tr.assignment_type as string) || "auto";

  if (cleaner?.phone) {
    await sendSms(admin, {
      toPhone: cleaner.phone,
      type: "job_offer",
      message: `New turnover: ${nickname}, ${property?.address || ""}. ${dateLabel}${windowLabel ? ` between ${windowLabel}` : ""}. Pay: ${share}. Reply YES to confirm. Access details + checklist: https://app.novaracleaning.com/cleaner/turnovers`,
    });
  }

  await notifyDiscord(admin, {
    title: "Turnover assigned",
    color: 3066993,
    fields: [
      { name: "Property", value: nickname, inline: true },
      { name: "When", value: `${dateLabel} ${windowLabel}`, inline: true },
      { name: "Cleaner", value: `${cleaner?.first_name || "Cleaner"} (${assignmentType})`, inline: true },
      { name: "Host", value: hostRow?.name || hostRow?.email || "-", inline: true },
      { name: "Price", value: money(priceNum), inline: true },
    ],
  });

  if (hostRow?.phone) {
    await sendSms(admin, {
      toPhone: hostRow.phone,
      type: "confirmation",
      message: `Your turnover for ${nickname} on ${dateLabel} is confirmed and assigned. We'll have it guest-ready${windowLabel ? ` by the end of your ${windowLabel} window` : ""}. - NovaraCleaning`,
    });
  }
  await sendPartnerEmail(admin, "turnover_assigned", hostRow?.email, {
    name: (hostRow?.name || "").split(" ")[0] || "",
    property: nickname, address: property?.address || "",
    date: dateLabel, window: windowLabel, cleaner: cleaner?.first_name || "Your cleaner",
  });
  if (cleaner?.email) {
    await sendPartnerEmail(admin, "turnover_assigned", cleaner.email, {
      name: cleaner.first_name || "", property: nickname, address: property?.address || "",
      date: dateLabel, window: windowLabel, cleaner: cleaner.first_name || "you",
    });
  }
}

// Assignment engine: property-preferred crew -> global crew by priority ->
// escalate (unassigned_alert + Discord + ops SMS). Same-day conflict aware.
export async function runAssignment(admin: SB, tr: Record<string, unknown>) {
  const propertyId = tr.property_id as string;
  const date = tr.requested_date as string;

  const { data: preferred } = await admin
    .from("turnover_crew").select("cleaner_id, priority")
    .eq("active", true).eq("is_turnover_crew", true).eq("property_id", propertyId)
    .order("priority", { ascending: true });
  const { data: pool } = await admin
    .from("turnover_crew").select("cleaner_id, priority")
    .eq("active", true).eq("is_turnover_crew", true).is("property_id", null)
    .order("priority", { ascending: true });

  const ordered = [
    ...(preferred || []).map((c: { cleaner_id: string }) => ({ id: c.cleaner_id, type: "preferred" as const })),
    ...(pool || []).map((c: { cleaner_id: string }) => ({ id: c.cleaner_id, type: "auto" as const })),
  ];

  const { data: sameDay } = await admin
    .from("turnover_requests").select("assigned_cleaner_id, window_start, window_end")
    .eq("requested_date", date).in("status", ["assigned", "cleaner_confirmed", "in_progress"]);
  const overlaps = (s1?: string | null, e1?: string | null, s2?: string | null, e2?: string | null) => {
    if (!s1 || !e1 || !s2 || !e2) return true;
    return s1 < e2 && s2 < e1;
  };
  const busy = new Set<string>();
  for (const r of sameDay || []) {
    if (r.assigned_cleaner_id && overlaps(tr.window_start as string, tr.window_end as string, r.window_start, r.window_end)) {
      busy.add(r.assigned_cleaner_id);
    }
  }

  const pick = ordered.find((c) => !busy.has(c.id));

  if (pick) {
    await admin.from("turnover_requests").update({
      assigned_cleaner_id: pick.id, assignment_type: pick.type,
      status: "assigned", assigned_at: new Date().toISOString(),
    }).eq("id", tr.id);
    const { data: fresh } = await admin.from("turnover_requests").select("*").eq("id", tr.id).single();
    await notifyAssignment(admin, fresh);
    return;
  }

  await admin.from("turnover_requests").update({ status: "unassigned_alert" }).eq("id", tr.id);
  const { property, hostRow } = await loadContext(admin, tr);
  await notifyDiscord(admin, {
    title: "UNASSIGNED turnover needs manual assignment",
    color: 15158332,
    fields: [
      { name: "Property", value: property?.nickname || property?.address || "-", inline: true },
      { name: "Date", value: `${formatServiceDate(date)} ${fmtWindow(tr.window_start as string, tr.window_end as string)}`, inline: true },
      { name: "Host", value: hostRow?.name || hostRow?.email || "-", inline: true },
      { name: "Why", value: "No turnover crew available for this date/window.", inline: false },
    ],
  });
  const opsPhone = (await resolveSecret(admin, "OPS_ALERT_PHONE")).trim();
  if (opsPhone) {
    await sendSms(admin, {
      toPhone: opsPhone, type: "reminder",
      message: `Novara: UNASSIGNED turnover ${property?.nickname || property?.address || ""} on ${formatServiceDate(date)} - no crew free. Assign manually in admin.`,
    });
  }
}

// Flip every pending turnover in a paid batch to paid and assign each
// independently (idempotent - only touches pending_payment rows).
export async function finalizeBatch(admin: SB, batchId: string) {
  const { data: batch } = await admin.from("booking_batches").select("*").eq("id", batchId).maybeSingle();
  if (!batch) return;
  const { data: turnovers } = await admin.from("turnover_requests").select("*").eq("batch_id", batchId);
  const list = (turnovers || []) as Array<Record<string, unknown>>;

  const { data: hostRow } = await admin.from("hosts").select("*").eq("id", batch.host_id).maybeSingle();
  await sendPartnerEmail(admin, "turnover_confirmed", hostRow?.email, {
    name: (hostRow?.name || "").split(" ")[0] || "",
    property: `${batch.turnover_count} turnovers (week of ${batch.week_start})`,
    date: `Week of ${formatServiceDate(batch.week_start as string)}`,
    price: money(Number(batch.total_amount || 0)),
  });

  for (const tr of list) {
    if (tr.status !== "pending_payment") continue;
    await admin.from("turnover_requests").update({
      status: "paid", paid_at: new Date().toISOString(),
      stripe_payment_intent_id: batch.stripe_payment_intent_id || null,
    }).eq("id", tr.id).eq("status", "pending_payment");
    const { data: fresh } = await admin.from("turnover_requests").select("*").eq("id", tr.id).single();
    await runAssignment(admin, fresh);
  }

  const { data: after } = await admin.from("turnover_requests").select("status").eq("batch_id", batchId);
  const statuses = (after || []).map((r: { status: string }) => r.status);
  const anyUnassigned = statuses.some((s: string) => s === "unassigned_alert" || s === "paid");
  await admin.from("booking_batches").update({ status: anyUnassigned ? "partially_assigned" : "complete" }).eq("id", batchId);
}
