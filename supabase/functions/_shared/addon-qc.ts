// Catalog add-ons → existing QC infrastructure (qc_issues + dispute packet).
//
// Site findings (pest/mold) already write their own qc_issues row. Fridge,
// oven, pet hair, etc. were only on bookings.add_ons / booking_addon_charges
// — they showed up as payment lines, not as a QC record. This helper upserts
// one issue_type='addon' row per booking so every add-on is on the QC hub
// and in the Drive packet, without a parallel system.
//
// Documentation, not a complaint: low severity, no Discord alert, excluded
// from cleaner quality scores.

import { CONTRACTOR_ADDON_CATALOG } from "./contractor-checklists.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

const SITE_FINDING_PREFIX = "site_finding_";

export const ADDON_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(CONTRACTOR_ADDON_CATALOG).map(([id, a]) => [id, a.label]),
);

export function labelOfAddon(id: string): string {
  return ADDON_LABELS[id] || CONTRACTOR_ADDON_CATALOG[id]?.label || id;
}

export function isCatalogAddonId(id: string): boolean {
  return Boolean(CONTRACTOR_ADDON_CATALOG[id] || ADDON_LABELS[id]);
}

export function isSiteFindingAddonId(id: string): boolean {
  return String(id).startsWith(SITE_FINDING_PREFIX);
}

function clientTypeOf(booking: Record<string, unknown>): string {
  const t = String(booking.booking_type || "");
  if (t === "commercial") return "commercial";
  if (t === "office") return "office";
  if (t === "str_turnover") return "str";
  if (t === "partnership") {
    const pd = booking.partner_details as Record<string, unknown> | null;
    return String(pd?.booking_type || "") === "str_turnover" ? "str" : "commercial";
  }
  return "residential";
}

function bookingRefOf(booking: Record<string, unknown>): string {
  const n = booking.booking_number;
  return n != null ? `NVC-${String(n).padStart(4, "0")}` : `Job ${String(booking.id).slice(0, 8)}`;
}

function httpUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter((u) => /^https?:\/\//i.test(u));
}

export type AddonQcSource = "booked" | "admin" | "contractor_request" | "pay_page";

export interface AddonQcLine {
  id: string;
  label: string;
  source: AddonQcSource;
  amount_cents: number | null;
  charge_status: string | null;
  charge_id: string | null;
  added_at: string | null;
}

export interface AddonQcDetails {
  kind: "addon";
  addons: AddonQcLine[];
  total_cents: number;
  before_photo_urls: string[];
  after_photo_urls: string[];
}

function catalogPriceCents(id: string, serviceType: string | null): number | null {
  if (String(serviceType) === "moveInOut" && (id === "fridge" || id === "oven")) return 0;
  const entry = CONTRACTOR_ADDON_CATALOG[id];
  return entry ? Math.round(entry.price * 100) : null;
}

function mergeLines(existing: AddonQcLine[], incoming: AddonQcLine[]): AddonQcLine[] {
  const byId = new Map<string, AddonQcLine>();
  for (const line of existing) {
    if (line?.id) byId.set(line.id, line);
  }
  for (const line of incoming) {
    if (!line?.id) continue;
    const prev = byId.get(line.id);
    byId.set(line.id, {
      id: line.id,
      label: line.label || prev?.label || labelOfAddon(line.id),
      source: line.source || prev?.source || "booked",
      amount_cents: line.amount_cents != null ? line.amount_cents : (prev?.amount_cents ?? null),
      charge_status: line.charge_status || prev?.charge_status || null,
      charge_id: line.charge_id || prev?.charge_id || null,
      added_at: line.added_at || prev?.added_at || null,
    });
  }
  return [...byId.values()];
}

function parseExistingLines(raw: unknown): AddonQcLine[] {
  if (!raw || typeof raw !== "object") return [];
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.addons)) return [];
  const out: AddonQcLine[] = [];
  for (const row of d.addons) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id || "").trim();
    if (!id) continue;
    out.push({
      id,
      label: String(r.label || labelOfAddon(id)),
      source: (["booked", "admin", "contractor_request", "pay_page"].includes(String(r.source))
        ? String(r.source) as AddonQcSource
        : "booked"),
      amount_cents: r.amount_cents == null ? null : Math.round(Number(r.amount_cents)),
      charge_status: r.charge_status ? String(r.charge_status) : null,
      charge_id: r.charge_id ? String(r.charge_id) : null,
      added_at: r.added_at ? String(r.added_at) : null,
    });
  }
  return out;
}

function buildDescription(lines: AddonQcLine[]): string {
  if (lines.length === 0) return "No catalog add-ons on this job.";
  const bullets = lines.map((l) => {
    const amt = l.amount_cents != null ? `$${(l.amount_cents / 100).toFixed(2)}` : "included";
    const st = l.charge_status ? ` · ${l.charge_status.replace(/_/g, " ")}` : "";
    return `• ${l.label} (${l.source.replace(/_/g, " ")}) — ${amt}${st}`;
  });
  return (
    "Catalog add-ons on this job. This QC record is the dispute-packet entry " +
    "for extra services (not a quality complaint).\n\n" +
    bullets.join("\n")
  );
}

function statusForLines(lines: AddonQcLine[]): "open" | "resolved" {
  const unpaid = lines.some((l) =>
    l.charge_status === "charge_failed" || l.charge_status === "invoiced" || l.charge_status === "pending",
  );
  return unpaid ? "open" : "resolved";
}

/**
 * Upsert one qc_issues row (issue_type=addon) covering every catalog add-on
 * on the booking. Site-finding add-on ids are skipped — they have their own
 * site_finding QC rows.
 */
export async function documentBookingAddonsInQc(
  supabase: SB,
  opts: {
    booking: Record<string, unknown>;
    source?: AddonQcSource;
    addedIds?: string[];
    amountCentsById?: Record<string, number>;
    chargeStatus?: string | null;
    chargeId?: string | null;
    note?: string | null;
  },
): Promise<string | null> {
  const booking = opts.booking;
  const bookingId = String(booking.id || "");
  if (!bookingId) return null;

  const booked = Array.isArray(booking.add_ons) ? booking.add_ons.map(String) : [];
  const added = (opts.addedIds || []).map(String);
  const ids = [...new Set([...booked, ...added])].filter((id) => id && !isSiteFindingAddonId(id));
  if (ids.length === 0 && added.length === 0) {
    // Still merge charge-history rows below.
  }

  const nowIso = new Date().toISOString();
  const serviceType = String(booking.service_type || "");

  const incoming: AddonQcLine[] = ids.map((id) => ({
    id,
    label: labelOfAddon(id),
    source: added.includes(id) ? (opts.source || "admin") : "booked",
    amount_cents: opts.amountCentsById?.[id] ?? catalogPriceCents(id, serviceType),
    charge_status: added.includes(id) ? (opts.chargeStatus || null) : null,
    charge_id: added.includes(id) ? (opts.chargeId || null) : null,
    added_at: nowIso,
  }));

  try {
    const { data: charges } = await supabase
      .from("booking_addon_charges")
      .select("id, added_addons, amount_cents, status, created_at")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true });
    for (const row of charges || []) {
      const list = Array.isArray(row.added_addons) ? row.added_addons.map(String) : [];
      const catalog = list.filter((id: string) => !isSiteFindingAddonId(id));
      if (catalog.length === 0) continue;
      const per = catalog.length > 0 ? Math.round(Number(row.amount_cents || 0) / catalog.length) : 0;
      for (const id of catalog) {
        incoming.push({
          id,
          label: labelOfAddon(id),
          source: "admin",
          amount_cents: opts.amountCentsById?.[id] ?? per,
          charge_status: String(row.status || ""),
          charge_id: String(row.id),
          added_at: row.created_at ? String(row.created_at) : nowIso,
        });
      }
    }
  } catch (_) { /* charges table is additive */ }

  if (incoming.length === 0) return null;

  const { data: existing } = await supabase
    .from("qc_issues")
    .select("id, details, status")
    .eq("booking_id", bookingId)
    .eq("issue_type", "addon")
    .maybeSingle();

  const merged = mergeLines(parseExistingLines(existing?.details), incoming);
  if (merged.length === 0) return null;

  const totalCents = merged.reduce((s, l) => s + Math.max(0, Number(l.amount_cents || 0)), 0);
  const details: AddonQcDetails = {
    kind: "addon",
    addons: merged,
    total_cents: totalCents,
    before_photo_urls: httpUrls(booking.before_photos),
    after_photo_urls: httpUrls(booking.after_photos),
  };
  const title = `Add-ons: ${merged.map((l) => l.label).join(", ")}`.slice(0, 200);
  const description = [buildDescription(merged), opts.note ? `\n${opts.note}` : ""].filter(Boolean).join("");
  const status = statusForLines(merged);
  const now = new Date().toISOString();

  const { data: docRow } = await supabase
    .from("job_documentation")
    .select("id")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (existing?.id) {
    const patch: Record<string, unknown> = {
      title,
      description,
      details,
      severity: "low",
      status,
      documentation_id: docRow?.id || null,
      job_id: booking.job_id || null,
      updated_at: now,
    };
    if (status === "resolved") {
      patch.resolved_at = now;
      patch.resolved_by_name = "System";
      patch.resolution_note =
        "Documented on the QC record for the dispute packet — not a quality complaint.";
    } else {
      patch.resolved_at = null;
      patch.resolved_by_name = null;
    }
    await supabase.from("qc_issues").update(patch).eq("id", existing.id);
    await supabase.from("qc_issue_events").insert({
      issue_id: existing.id,
      action: "note",
      note: `Add-on documentation refreshed (${merged.length} service${merged.length === 1 ? "" : "s"}).`,
      actor_name: "System",
      data: { issue_type: "addon", total_cents: totalCents },
    }).then(() => undefined, () => undefined);
    return String(existing.id);
  }

  const { data: issue, error } = await supabase
    .from("qc_issues")
    .insert({
      booking_id: bookingId,
      job_id: booking.job_id || null,
      client_type: clientTypeOf(booking),
      documentation_id: docRow?.id || null,
      cleaner_id: null,
      cleaner_name: null,
      cleaners: [],
      client_name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || null,
      client_email: booking.email || null,
      booking_ref: bookingRefOf(booking),
      issue_type: "addon",
      severity: "low",
      status,
      title,
      description,
      details,
      reported_via: "system",
      reported_by_name: "Add-on documentation",
      resolution_note: status === "resolved"
        ? "Documented on the QC record for the dispute packet — not a quality complaint."
        : null,
      resolved_at: status === "resolved" ? now : null,
      resolved_by_name: status === "resolved" ? "System" : null,
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (issue?.id) {
    await supabase.from("qc_issue_events").insert({
      issue_id: issue.id,
      action: "created",
      to_status: status,
      note: description.slice(0, 2000),
      actor_name: "System",
      data: { issue_type: "addon", total_cents: totalCents },
    }).then(() => undefined, () => undefined);
  }
  return issue?.id ? String(issue.id) : null;
}

/** Best-effort wrapper — add-on QC must never fail a charge or completion. */
export async function documentBookingAddonsInQcSafe(
  supabase: SB,
  opts: Parameters<typeof documentBookingAddonsInQc>[1],
): Promise<void> {
  try {
    await documentBookingAddonsInQc(supabase, opts);
  } catch (e) {
    console.warn(
      "[addon-qc] documentation failed (non-blocking)",
      e instanceof Error ? e.message : String(e),
    );
  }
}
