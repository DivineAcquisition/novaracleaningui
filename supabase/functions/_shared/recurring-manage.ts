// ─── Recurring-schedule manage-link helpers ──────────────────────────────
//
// Shared by manage-recurring-schedule (the tokenized customer API),
// send-recurring-manage-link (SMS sender), and customer-recurring-generate.

export const RECURRING_MANAGE_BASE = "https://app.novaracleaning.com/manage-recurring";

export function manageUrlForToken(token: string): string {
  return `${RECURRING_MANAGE_BASE}/${token}`;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Get-or-mint the schedule's manage token. */
export async function ensureManageToken(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  scheduleId: string,
): Promise<string | null> {
  const { data: sched } = await supabase
    .from("customer_recurring_schedules")
    .select("id, manage_token")
    .eq("id", scheduleId)
    .maybeSingle();
  if (!sched) return null;
  if (sched.manage_token) return sched.manage_token;
  const token = randomToken();
  const { error } = await supabase
    .from("customer_recurring_schedules")
    .update({ manage_token: token, updated_at: new Date().toISOString() })
    .eq("id", scheduleId)
    .is("manage_token", null);
  if (error) {
    const { data: raced } = await supabase
      .from("customer_recurring_schedules")
      .select("manage_token")
      .eq("id", scheduleId)
      .maybeSingle();
    return raced?.manage_token || null;
  }
  return token;
}

/** Advance one cadence step (frequency-aware: weekly/biweekly/monthly). */
export function advanceDate(date: string, cadence: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else if (cadence === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 14); // biweekly default
  return d.toISOString().slice(0, 10);
}

/** The next `count` visit dates implied by a start date + cadence. */
export function previewDates(startDate: string, cadence: string, count = 4): string[] {
  const out: string[] = [];
  let d = startDate;
  for (let i = 0; i < count; i++) {
    out.push(d);
    d = advanceDate(d, cadence);
  }
  return out;
}
