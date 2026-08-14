import { NextResponse } from "next/server";

import { ALL_PLATFORMS, emptyEntry, PLATFORM_HELP, type ChannelEntry } from "@/lib/ad-spend/platforms";
import { formatRangeLabel } from "@/lib/ad-spend/period";
import { loadExistingEntries, loadSettings, loadToken, submitAdSpendForm } from "@/lib/ad-spend/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!token) return NextResponse.json({ ok: false, error: "Missing token." }, { status: 400 });

  const tok = await loadToken(token);
  if (!tok) return NextResponse.json({ ok: false, error: "This link is invalid." }, { status: 404 });
  if (tok.status === "expired" || (tok.expires_at && new Date(tok.expires_at).getTime() < Date.now())) {
    return NextResponse.json(
      { ok: false, error: "This link has expired. Ask ops to resend the monthly form." },
      { status: 410 },
    );
  }

  const settings = await loadSettings();
  const existing = await loadExistingEntries(tok.period_start, tok.period_end);
  const platforms = [...settings.platforms];
  if (!platforms.includes("Other")) platforms.push("Other");

  const entries: ChannelEntry[] = platforms.map((platform) => existing[platform] || emptyEntry(platform));

  return NextResponse.json({
    ok: true,
    periodStart: tok.period_start,
    periodEnd: tok.period_end,
    rangeLabel: formatRangeLabel(tok.period_start, tok.period_end),
    status: tok.status,
    submittedAt: tok.submitted_at,
    platforms,
    help: PLATFORM_HELP,
    allPlatforms: ALL_PLATFORMS,
    entries,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    entries?: ChannelEntry[];
    email?: string;
  };
  if (!body.token) return NextResponse.json({ ok: false, error: "Missing token." }, { status: 400 });
  try {
    const result = await submitAdSpendForm({
      token: body.token,
      entries: Array.isArray(body.entries) ? body.entries : [],
      submittedByEmail: body.email || null,
    });
    return NextResponse.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status },
    );
  }
}
