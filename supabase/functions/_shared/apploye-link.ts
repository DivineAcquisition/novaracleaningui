// Link onboarded cleaners and VAs to Apploye members by email, and record
// the Apploye clock against a job arrival. Apploye's MCP cannot create
// members or start a timer, so an email that isn't in the workspace is
// marked invite_needed and the admin invites them from the dashboard.

import {
  APPLOYE_ORG_TIMEZONE,
  arrivalKey,
  arrivalStatus,
  businessDay,
  manualInviteUrl,
  matchArrivalPunch,
  matchMemberByEmail,
  projectClockins,
  projectLiveSessions,
  type ApployeMember,
} from "./apploye-attendance.ts";
import { callApployeTool, getMcpConfig, listMcpMembers, type McpConfig } from "./apploye-mcp.ts";

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export interface LinkResult {
  ok: boolean;
  linked: boolean;
  memberId: string | null;
  memberEmail: string | null;
  alreadyLinked?: boolean;
  manualInviteUrl?: string;
  message?: string;
  error?: string;
}

let memberCache: { at: number; members: ApployeMember[] } | null = null;

async function members(cfg: McpConfig): Promise<ApployeMember[]> {
  if (memberCache && Date.now() - memberCache.at < 30_000) return memberCache.members;
  const list = await listMcpMembers(cfg);
  memberCache = { at: Date.now(), members: list };
  return list;
}

function inviteMessage(email: string): string {
  return `${email} isn't in Apploye yet. Invite them from the Apploye dashboard, then link again once they accept.`;
}

async function stampLink(
  supabase: SupabaseLike,
  table: "cleaners" | "va_onboarding",
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabase.from(table).update({
    ...patch,
    apploye_link_checked_at: new Date().toISOString(),
  }).eq("id", id);
}

export async function linkCleaner(supabase: SupabaseLike, cleanerId: string): Promise<LinkResult> {
  const { data: cleaner } = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, email, apploye_member_id")
    .eq("id", cleanerId)
    .maybeSingle();
  if (!cleaner) return { ok: false, linked: false, memberId: null, memberEmail: null, error: "cleaner not found" };
  if (!cleaner.email) {
    return { ok: false, linked: false, memberId: null, memberEmail: null, error: "cleaner has no email" };
  }
  if (cleaner.apploye_member_id) {
    return {
      ok: true,
      linked: true,
      alreadyLinked: true,
      memberId: cleaner.apploye_member_id,
      memberEmail: cleaner.email,
    };
  }

  const cfg = await getMcpConfig(supabase);
  if (!cfg) {
    return {
      ok: false,
      linked: false,
      memberId: null,
      memberEmail: cleaner.email,
      error: "Apploye not configured",
      message: "Set APPLOYE_MCP_API_KEY in app_secrets.",
    };
  }

  const name = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim();
  const match = matchMemberByEmail(await members(cfg), cleaner.email);
  if (match) {
    await stampLink(supabase, "cleaners", cleanerId, {
      apploye_member_id: match.id,
      apploye_link_status: "linked",
      apploye_invited_at: new Date().toISOString(),
    });
    await supabase.from("events").insert({
      event_type: "cleaner.apploye_linked",
      cleaner_id: cleanerId,
      source: "apploye-link",
      summary: `Linked ${cleaner.email} to Apploye`,
      data: { memberId: match.id },
    }).then(() => undefined).catch(() => undefined);
    return { ok: true, linked: true, memberId: match.id, memberEmail: cleaner.email };
  }

  const dashboardUrl = manualInviteUrl(cleaner.email, name);
  await stampLink(supabase, "cleaners", cleanerId, { apploye_link_status: "invite_needed" });
  await supabase.from("events").insert({
    event_type: "cleaner.apploye_manual_invite_needed",
    cleaner_id: cleanerId,
    source: "apploye-link",
    summary: `${cleaner.email} needs an Apploye invite`,
    data: { dashboardUrl },
  }).then(() => undefined).catch(() => undefined);
  return {
    ok: true,
    linked: false,
    memberId: null,
    memberEmail: cleaner.email,
    manualInviteUrl: dashboardUrl,
    message: inviteMessage(cleaner.email),
  };
}

export async function linkVa(supabase: SupabaseLike, vaId: string): Promise<LinkResult> {
  const { data: va } = await supabase
    .from("va_onboarding")
    .select("id, first_name, last_name, email, apploye_member_id, status")
    .eq("id", vaId)
    .maybeSingle();
  if (!va) return { ok: false, linked: false, memberId: null, memberEmail: null, error: "VA not found" };
  if (!va.email) return { ok: false, linked: false, memberId: null, memberEmail: null, error: "VA has no email" };
  if (va.apploye_member_id) {
    return {
      ok: true,
      linked: true,
      alreadyLinked: true,
      memberId: va.apploye_member_id,
      memberEmail: va.email,
    };
  }

  const cfg = await getMcpConfig(supabase);
  if (!cfg) {
    return {
      ok: false,
      linked: false,
      memberId: null,
      memberEmail: va.email,
      error: "Apploye not configured",
      message: "Set APPLOYE_MCP_API_KEY in app_secrets.",
    };
  }

  const name = `${va.first_name || ""} ${va.last_name || ""}`.trim();
  const match = matchMemberByEmail(await members(cfg), va.email);
  if (match) {
    await stampLink(supabase, "va_onboarding", vaId, {
      apploye_member_id: match.id,
      apploye_link_status: "linked",
    });
    await supabase.from("events").insert({
      event_type: "va.apploye_linked",
      source: "apploye-link",
      summary: `Linked ${va.email} to Apploye`,
      data: { vaId, memberId: match.id },
    }).then(() => undefined).catch(() => undefined);
    return { ok: true, linked: true, memberId: match.id, memberEmail: va.email };
  }

  const dashboardUrl = manualInviteUrl(va.email, name);
  await stampLink(supabase, "va_onboarding", vaId, { apploye_link_status: "invite_needed" });
  return {
    ok: true,
    linked: false,
    memberId: null,
    memberEmail: va.email,
    manualInviteUrl: dashboardUrl,
    message: inviteMessage(va.email),
  };
}

export async function backfillLinks(supabase: SupabaseLike): Promise<{
  cleanersLinked: number;
  cleanersInviteNeeded: number;
  vasLinked: number;
  vasInviteNeeded: number;
}> {
  const totals = { cleanersLinked: 0, cleanersInviteNeeded: 0, vasLinked: 0, vasInviteNeeded: 0 };

  const { data: cleaners } = await supabase
    .from("cleaners")
    .select("id, status, onboarding_complete")
    .is("apploye_member_id", null)
    .not("email", "is", null)
    .in("status", ["active", "pending"])
    .limit(500);
  for (const cleaner of cleaners || []) {
    const working = String(cleaner.status || "").toLowerCase() === "active";
    if (!working && !cleaner.onboarding_complete) continue;
    const result = await linkCleaner(supabase, cleaner.id);
    if (result.linked && !result.alreadyLinked) totals.cleanersLinked += 1;
    else if (!result.linked && result.ok) totals.cleanersInviteNeeded += 1;
  }

  const { data: vas } = await supabase
    .from("va_onboarding")
    .select("id")
    .is("apploye_member_id", null)
    .in("status", ["submitted", "approved"])
    .limit(500);
  for (const va of vas || []) {
    const result = await linkVa(supabase, va.id);
    if (result.linked && !result.alreadyLinked) totals.vasLinked += 1;
    else if (!result.linked && result.ok) totals.vasInviteNeeded += 1;
  }
  return totals;
}

async function checkedInAt(
  supabase: SupabaseLike,
  args: { jobId?: string | null; bookingId?: string | null },
): Promise<string> {
  if (args.jobId) {
    const { data } = await supabase.from("jobs").select("check_in_time").eq("id", args.jobId).maybeSingle();
    if (data?.check_in_time) return String(data.check_in_time);
  }
  if (args.bookingId) {
    const { data } = await supabase.from("bookings").select("check_in_time").eq("id", args.bookingId).maybeSingle();
    if (data?.check_in_time) return String(data.check_in_time);
  }
  return new Date().toISOString();
}

export async function recordArrival(
  supabase: SupabaseLike,
  args: { jobId?: string | null; bookingId?: string | null; cleanerId: string; assignmentId?: string | null },
): Promise<Record<string, unknown>> {
  if (!args.cleanerId || (!args.jobId && !args.bookingId)) {
    return { ok: false, error: "cleanerId and jobId or bookingId are required" };
  }
  const when = await checkedInAt(supabase, args);
  const link = await linkCleaner(supabase, args.cleanerId);
  const cfg = await getMcpConfig(supabase);
  const key = arrivalKey({ jobId: args.jobId, bookingId: args.bookingId, cleanerId: args.cleanerId });

  let status = arrivalStatus({
    configured: Boolean(cfg),
    memberId: link.memberId,
    live: false,
    punch: null,
  });
  let punch: ReturnType<typeof matchArrivalPunch> = null;
  let live = false;
  let detail: string | null = link.ok ? null : (link.message || link.error || null);

  if (cfg && link.memberId) {
    const day = businessDay(when, APPLOYE_ORG_TIMEZONE);
    try {
      const [clockPayload, livePayload] = await Promise.all([
        callApployeTool(cfg, "list_clockinouts", {
          start_date: day,
          end_date: day,
          user_id: link.memberId,
          timezone: APPLOYE_ORG_TIMEZONE,
          limit: 20,
        }),
        callApployeTool(cfg, "list_live_tracking_members", { limit: 100 }),
      ]);
      punch = matchArrivalPunch(projectClockins(clockPayload), day, when);
      live = projectLiveSessions(livePayload).some((session) => session.memberId === link.memberId);
      status = arrivalStatus({ configured: true, memberId: link.memberId, live, punch });
      detail = null;
    } catch (err) {
      status = "unavailable";
      detail = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
    }
  }

  if (status === "unavailable") {
    const { data: existing } = await supabase
      .from("cleaner_arrivals")
      .select("apploye_status, apploye_clock_in_at")
      .eq("arrival_key", key)
      .maybeSingle();
    if (existing?.apploye_clock_in_at) {
      return { ok: true, status: existing.apploye_status, keptExisting: true, arrivalKey: key };
    }
  }

  const row = {
    arrival_key: key,
    cleaner_id: args.cleanerId,
    job_id: args.jobId || null,
    booking_id: args.bookingId || null,
    job_assignment_id: args.assignmentId || null,
    checked_in_at: when,
    apploye_member_id: link.memberId,
    apploye_status: status,
    apploye_clock_in_at: punch?.clockIn || null,
    apploye_clock_out_at: punch?.clockOut || null,
    apploye_tracked_seconds: punch?.durationSeconds ?? null,
    apploye_live: live,
    detail,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("cleaner_arrivals").upsert(row, { onConflict: "arrival_key" });
  if (error) return { ok: false, error: error.message };

  if (live || punch?.clockIn) {
    await supabase
      .from("cleaners")
      .update({ apploye_last_ping_at: new Date().toISOString() })
      .eq("id", args.cleanerId);
  }

  const who = link.memberEmail || args.cleanerId;
  await supabase.from("events").insert({
    event_type: "cleaner.apploye_arrival",
    cleaner_id: args.cleanerId,
    job_id: args.jobId || null,
    booking_id: args.bookingId || null,
    source: "apploye-record-arrival",
    summary: `Arrival for ${who}: Apploye ${status.replaceAll("_", " ")}`,
    data: {
      status,
      clockIn: punch?.clockIn || null,
      clockOut: punch?.clockOut || null,
      live,
    },
  }).then(() => undefined).catch(() => undefined);

  return {
    ok: true,
    status,
    live,
    memberId: link.memberId,
    clockIn: punch?.clockIn || null,
    clockOut: punch?.clockOut || null,
    trackedSeconds: punch?.durationSeconds ?? null,
    arrivalKey: key,
    detail,
  };
}

export async function recordCheckout(
  supabase: SupabaseLike,
  args: { jobId?: string | null; bookingId?: string | null },
): Promise<Record<string, unknown>> {
  if (!args.jobId && !args.bookingId) return { ok: false, error: "jobId or bookingId required" };
  let query = supabase.from("cleaner_arrivals").select("*").is("checked_out_at", null);
  query = args.jobId ? query.eq("job_id", args.jobId) : query.eq("booking_id", args.bookingId);
  const { data: rows, error } = await query;
  if (error) return { ok: false, error: error.message };

  const now = new Date().toISOString();
  const day = businessDay(now, APPLOYE_ORG_TIMEZONE);
  const cfg = await getMcpConfig(supabase);
  let closed = 0;

  for (const row of rows || []) {
    const patch: Record<string, unknown> = {
      checked_out_at: now,
      updated_at: now,
    };
    if (cfg && row.apploye_member_id) {
      try {
        const payload = await callApployeTool(cfg, "list_clockinouts", {
          start_date: day,
          end_date: day,
          user_id: row.apploye_member_id,
          timezone: APPLOYE_ORG_TIMEZONE,
          limit: 20,
        });
        const punch = matchArrivalPunch(projectClockins(payload), day, String(row.checked_in_at || now));
        if (punch) {
          patch.apploye_clock_in_at = punch.clockIn;
          patch.apploye_clock_out_at = punch.clockOut;
          patch.apploye_tracked_seconds = punch.durationSeconds;
          patch.apploye_live = punch.open;
          patch.apploye_status = punch.open ? "tracking" : "clocked_out";
        }
      } catch (err) {
        patch.detail = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
      }
    }
    await supabase.from("cleaner_arrivals").update(patch).eq("id", row.id);
    closed += 1;
  }
  return { ok: true, closed };
}
