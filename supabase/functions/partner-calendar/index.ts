// --- partner-calendar ------------------------------------------------------
//
// Private iCal (.ics) feed of a host's turnovers so partners can subscribe in
// Google / Apple Calendar. Authenticated by an unguessable per-host
// calendar_token (?token=...), so it needs no login (verify_jwt = false).
//
// Emits every non-cancelled turnover from a week ago onward as a VEVENT
// (timed when a window is set, otherwise all-day).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// deno-lint-ignore no-explicit-any
type SB = any;

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid · assigning",
  assigned: "Assigned",
  cleaner_confirmed: "Cleaner confirmed",
  in_progress: "In progress",
  completed: "Completed",
  unassigned_alert: "Finding a cleaner",
};

function pad(n: number): string { return String(n).padStart(2, "0"); }
function icsDate(d: string): string { return d.replace(/-/g, ""); } // YYYYMMDD
function icsDateTime(date: string, time: string): string {
  const [h, m] = time.split(":");
  return `${icsDate(date)}T${pad(parseInt(h, 10))}${pad(parseInt(m || "0", 10))}00`;
}
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function esc(s: string): string {
  return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

serve(async (req) => {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") || "").trim();
  if (!token) return new Response("Missing token", { status: 400 });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  ) as SB;

  const { data: host } = await admin.from("hosts").select("id, name").eq("calendar_token", token).maybeSingle();
  if (!host) return new Response("Invalid token", { status: 404 });

  const since = addDaysIso(new Date().toISOString().slice(0, 10), -7);
  const { data: rows } = await admin
    .from("turnover_requests")
    .select("id, requested_date, window_start, window_end, status, property_id")
    .eq("host_id", host.id)
    .neq("status", "cancelled")
    .gte("requested_date", since)
    .order("requested_date", { ascending: true });

  const turnovers = (rows || []) as Array<Record<string, string | null>>;
  const propIds = Array.from(new Set(turnovers.map((t) => t.property_id).filter(Boolean))) as string[];
  const propById: Record<string, { nickname?: string; address?: string }> = {};
  if (propIds.length) {
    const { data: props } = await admin.from("properties").select("id, nickname, address").in("id", propIds);
    for (const p of (props || []) as Array<Record<string, string>>) propById[p.id] = { nickname: p.nickname, address: p.address };
  }

  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Novara Cleaning//Partner Turnovers//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Novara Turnovers",
    "X-WR-CALDESC:Your scheduled Novara turnover cleanings",
  ];

  for (const t of turnovers) {
    const date = t.requested_date as string;
    const prop = t.property_id ? propById[t.property_id] : undefined;
    const title = prop?.nickname || prop?.address || "Turnover";
    const status = STATUS_LABEL[t.status || ""] || (t.status || "");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:turnover-${t.id}@novaracleaning`);
    lines.push(`DTSTAMP:${stamp}`);
    if (t.window_start && t.window_end) {
      lines.push(`DTSTART:${icsDateTime(date, t.window_start as string)}`);
      lines.push(`DTEND:${icsDateTime(date, t.window_end as string)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(date)}`);
      lines.push(`DTEND;VALUE=DATE:${icsDate(addDaysIso(date, 1))}`);
    }
    lines.push(`SUMMARY:${esc(`Turnover — ${title}`)}`);
    lines.push(`DESCRIPTION:${esc(`Status: ${status}`)}`);
    if (prop?.address) lines.push(`LOCATION:${esc(prop.address)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="novara-turnovers.ics"',
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
