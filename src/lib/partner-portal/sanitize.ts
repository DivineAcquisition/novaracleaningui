// Least-visibility + non-circumvention: never return cleaner/crew contact
// (Host Agreement §7 / Commercial Agreement §10) or another partner's data.

const CREW_KEY =
  /^(assigned_cleaner_id|cleaner_id|cleaner_name|cleaner_phone|cleaner_email|crew|roster|firstName|first_name|phone|mobile|email)$/i;

const CREW_NESTED =
  /cleaner|crew.?member|contractor.?phone|assigned_to/i;

export function stripCrewContact<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (CREW_KEY.test(k) || CREW_NESTED.test(k)) continue;
    out[k] = walk(v);
  }
  return out;
}

export function publicTurnoverStatus(status: string): string {
  const s = String(status || "");
  if (s === "cleaner_confirmed") return "confirmed";
  if (s === "unassigned_alert") return "assigning";
  return s;
}

export function publicStatusLabel(status: string): string {
  switch (publicTurnoverStatus(status)) {
    case "pending_payment":
      return "Awaiting payment";
    case "paid":
      return "Booked";
    case "assigned":
      return "Scheduled";
    case "confirmed":
      return "Confirmed";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "assigning":
      return "Scheduling";
    default:
      return status.replace(/_/g, " ");
  }
}
