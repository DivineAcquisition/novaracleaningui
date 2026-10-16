import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { notifyGhlEmailDnd } from "@/lib/email-compliance/ghl";
import { emailForToken, suppressAddress } from "@/lib/email-compliance/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenFrom(req: Request, body?: Record<string, unknown>): string {
  const url = new URL(req.url);
  const query = url.searchParams.get("t") || url.searchParams.get("token") || "";
  if (query) return query;
  if (typeof body?.t === "string") return body.t;
  if (typeof body?.token === "string") return body.token;
  return "";
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, 2)}***@${domain}`;
}

async function honor(token: string) {
  const supabase = getAdminSupabase();
  const email = await emailForToken(supabase, token);
  if (!email) return NextResponse.json({ ok: false, error: "This unsubscribe link is not valid." }, { status: 404 });
  const result = await suppressAddress(supabase, {
    email,
    reason: "unsubscribe",
    source: "unsubscribe_link",
    actor: "contact",
  });
  void notifyGhlEmailDnd(email);
  return NextResponse.json({
    ok: result.ok,
    unsubscribed: result.ok,
    email: maskEmail(email),
    at: result.at,
    smsUnchanged: true,
  });
}

export async function GET(req: Request): Promise<NextResponse> {
  const token = tokenFrom(req);
  if (!token) return NextResponse.json({ ok: false, error: "Missing token." }, { status: 400 });
  try {
    return await honor(token);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Unsubscribe failed." }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim().startsWith("{")) body = JSON.parse(text);
    else if (text.includes("=")) body = Object.fromEntries(new URLSearchParams(text).entries());
  } catch {
    body = {};
  }
  const token = tokenFrom(req, body);
  if (!token) return NextResponse.json({ ok: false, error: "Missing token." }, { status: 400 });
  try {
    return await honor(token);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Unsubscribe failed." }, { status: 500 });
  }
}
