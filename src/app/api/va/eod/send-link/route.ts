// ─── Deliver each VA their tokenized EOD link ─────────────────────────────────
//
// Called two ways, matching the talent-sync convention:
//   pg_cron  — ?secret= (or x-va-metrics-secret) matching VA_METRICS_SYNC_SECRET
//   admin    — bearer token, from the VA Performance tab
//
// Actions:
//   send_all — the daily send. Idempotent per day unless `force`.
//   send     — one VA, on demand.
//   rotate   — issue a fresh token (invalidating the old link) and resend.
//
// The token only ever goes to the VA: email always, plus their private Discord
// channel when one is configured. See src/lib/va-performance/eod-link.ts for
// why it never goes to a shared channel.

import { NextResponse } from "next/server";

import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendEodLink, sendEodLinksToAll } from "@/lib/va-performance/eod-link";
import { primePerformanceSecrets } from "@/lib/va-performance/settings";
import { getVaById } from "@/lib/va-performance/vas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function resolveSecret(name: string): Promise<string> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value) return String(data.value).trim();
  } catch {
    /* fall through to env */
  }
  return (process.env[name] || "").trim();
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const provided =
    new URL(req.url).searchParams.get("secret") || req.headers.get("x-va-metrics-secret") || "";
  const expected = await resolveSecret("VA_METRICS_SYNC_SECRET");
  const viaSecret = Boolean(expected) && provided === expected;

  if (!viaSecret) {
    try {
      await requireAdmin(req);
    } catch (err) {
      const e = err as AdminAuthError;
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 401 });
    }
  }

  await primePerformanceSecrets();
  const action = String(body.action || "send_all");

  try {
    if (action === "send_all") {
      const report = await sendEodLinksToAll({
        workDate: body.workDate ? String(body.workDate) : undefined,
        force: Boolean(body.force),
      });
      return NextResponse.json({ ok: true, ...report });
    }

    if (action === "send" || action === "rotate") {
      const vaId = String(body.vaId || "");
      if (!vaId) return NextResponse.json({ ok: false, error: "Missing vaId." }, { status: 400 });
      const va = await getVaById(vaId);
      if (!va) return NextResponse.json({ ok: false, error: "VA not found." }, { status: 404 });

      const result = await sendEodLink(va, { rotate: action === "rotate" });
      if (!result.emailed && !result.discorded) {
        return NextResponse.json(
          {
            ok: false,
            error: va.email
              ? "Couldn't deliver the link — check RESEND_API_KEY, or set a Discord webhook for this VA."
              : "This VA has no email on file.",
            ...result,
          },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ ok: false, error: `Unsupported action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("[va-eod-link] failed:", (err as Error).message);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

/** pg_cron can also just GET with ?secret=. */
export async function GET(req: Request): Promise<NextResponse> {
  const provided = new URL(req.url).searchParams.get("secret") || "";
  const expected = await resolveSecret("VA_METRICS_SYNC_SECRET");
  if (!expected || provided !== expected) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }
  await primePerformanceSecrets();
  const report = await sendEodLinksToAll();
  return NextResponse.json({ ok: true, ...report });
}
