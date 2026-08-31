// ─── Read-only, permission-scoped live data ───────────────────────────────
//
// The assistant may look at the record the person is on. It may not write,
// send, or change anything. VAs do not see commercial / payroll / pricing-
// config rows even if they guess an id.

import type { LiveFact } from "./answer";
import type { AssistantRole, PageContext } from "./types";

type SB = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

const VA_BLOCKED_KINDS = new Set(["account"]);

function dollars(cents: unknown): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return `$${(n / 100).toFixed(2)}`;
}

export async function loadLiveFacts(args: {
  supabase: SB | null;
  role: AssistantRole;
  page?: PageContext | null;
}): Promise<LiveFact[]> {
  const rec = args.page?.record;
  if (!args.supabase || !rec?.id) return [];
  if (args.role !== "admin" && VA_BLOCKED_KINDS.has(rec.kind)) {
    return [
      {
        label: "Access",
        value: "This record sits on an admin-only screen. I can't read it for a VA.",
        source: "permission scope",
      },
    ];
  }

  try {
    if (rec.kind === "booking") return await loadBooking(args.supabase, rec.id);
    if (rec.kind === "customer") return await loadCustomer(args.supabase, rec.id);
    if (rec.kind === "account") return await loadAccount(args.supabase, rec.id);
    if (rec.kind === "cleaner") return await loadCleaner(args.supabase, rec.id, args.role);
  } catch (err) {
    console.warn("[ops-assistant] live data failed", err);
  }
  return [];
}

async function loadBooking(sb: SB, id: string): Promise<LiveFact[]> {
  const { data, error } = await sb
    .from("bookings")
    .select(
      "id, booking_number, status, service_type, service_date, time_slot, first_name, last_name, email, phone, city, zip_code, total_estimate_cents, deposit_cents, payment_received_at, customer_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return [];
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || "—";
  return [
    { label: "Booking", value: data.booking_number != null ? `#${data.booking_number}` : id.slice(0, 8), source: "bookings row" },
    { label: "Customer", value: name, source: "bookings row" },
    { label: "Status", value: String(data.status || "—"), source: "bookings row" },
    { label: "Service", value: String(data.service_type || "—"), source: "bookings row" },
    { label: "Date", value: String(data.service_date || "—"), source: "bookings row" },
    { label: "Quoted total", value: dollars(data.total_estimate_cents), source: "bookings.total_estimate_cents (stored quote, not re-priced here)" },
    { label: "Deposit paid", value: data.payment_received_at ? "yes" : "no", source: "bookings.payment_received_at" },
  ];
}

async function loadCustomer(sb: SB, id: string): Promise<LiveFact[]> {
  const { data, error } = await sb
    .from("customers")
    .select("id, first_name, last_name, email, phone, city, state, zip")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return [];
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || data.email || "—";
  return [
    { label: "Customer", value: name, source: "customers row" },
    { label: "Email", value: String(data.email || "—"), source: "customers row" },
    { label: "Phone", value: String(data.phone || "—"), source: "customers row" },
    { label: "Location", value: [data.city, data.state, data.zip].filter(Boolean).join(", ") || "—", source: "customers row" },
  ];
}

async function loadAccount(sb: SB, id: string): Promise<LiveFact[]> {
  const { data: acct, error } = await sb
    .from("business_accounts")
    .select("id, business_name, status, city")
    .eq("id", id)
    .maybeSingle();
  if (error || !acct) return [];

  const facts: LiveFact[] = [
    { label: "Account", value: String(acct.business_name || id.slice(0, 8)), source: "business_accounts row" },
    { label: "Status", value: String(acct.status || "—"), source: "business_accounts row" },
  ];

  try {
    const { data: coi } = await sb.rpc("commercial_coi_status", { p_account_id: id });
    const row = coi && typeof coi === "object" ? (coi as Record<string, unknown>) : null;
    if (row) {
      facts.push({
        label: "COI status",
        value: String(row.status || "unknown"),
        source: "commercial_coi_status() — computed from the certificate expiry, never stored",
      });
      facts.push({
        label: "COI blocked",
        value: row.blocked === true ? "yes — new bookings, recurring generation and dispatch are blocked" : "no",
        source: "commercial_coi_status()",
      });
      if (row.expiration_date) {
        facts.push({
          label: "COI expires",
          value: String(row.expiration_date),
          source: "commercial_coi_status()",
        });
      }
    }
  } catch {
    // Function may not be deployed in a preview — skip, don't invent a status.
  }

  return facts;
}

async function loadCleaner(sb: SB, id: string, role: AssistantRole): Promise<LiveFact[]> {
  const { data, error } = await sb
    .from("cleaners")
    .select("id, first_name, last_name, status, city, available_for_bookings")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return [];
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || id.slice(0, 8);
  const facts: LiveFact[] = [
    { label: "Cleaner", value: name, source: "cleaners row" },
    { label: "Status", value: String(data.status || "—"), source: "cleaners row" },
    { label: "Available for bookings", value: data.available_for_bookings === false ? "no" : "yes", source: "cleaners.available_for_bookings" },
  ];
  // Pay rates are admin-only.
  if (role !== "admin") {
    facts.push({
      label: "Pay",
      value: "Pay figures are admin-only. I won't recall or compute them for a VA.",
      source: "permission scope",
    });
  }
  return facts;
}

/** Detect a live-data question even when no record is selected, so we say so. */
export function wantsLiveData(message: string): boolean {
  return /\b(this (booking|account|customer|cleaner|job)|coi status|certificate|current status|what's on (this|the) (account|booking)|how much (did|have) they)\b/i.test(
    message || "",
  );
}
