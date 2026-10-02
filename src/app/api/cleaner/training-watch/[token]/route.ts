// Tokenized training page — no login. The link only opens the expectation
// video. It does not read or write a contractor record.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

function tokenOf(raw: string): string | null {
  const token = String(raw || "").trim();
  if (token.length < 32 || token.length > 128) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(token)) return null;
  return token;
}

export async function GET(_req: Request, ctx: Ctx): Promise<NextResponse> {
  const token = tokenOf((await ctx.params).token);
  if (!token) {
    return NextResponse.json({ error: "This training link isn't valid.", reason: "invalid" }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const { data, error } = await (supabase.from as any)("training_watch_tokens")
    .select("token, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Couldn't open this training link.", reason: "error" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "This training link isn't valid.", reason: "invalid" },
      { status: 404 },
    );
  }
  if (data.expires_at && new Date(String(data.expires_at)).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "This training link has expired.", reason: "expired" },
      { status: 410 },
    );
  }

  return NextResponse.json({ ok: true });
}
