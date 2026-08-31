import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { recordPartnershipOptOut } from "@/lib/partnership-comms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenFrom(req: Request, body?: Record<string, unknown>): string {
  const url = new URL(req.url);
  const q = url.searchParams.get("t") || url.searchParams.get("token") || "";
  if (q) return String(q);
  if (body && typeof body.t === "string") return body.t;
  if (body && typeof body.token === "string") return body.token;
  return "";
}

async function lookup(token: string) {
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("partnership_messages")
    .select("id, to_email, to_phone, channel, unsubscribe_token")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  return { supabase, row: data as {
    id: string;
    to_email: string | null;
    to_phone: string | null;
    channel: string;
  } | null };
}

function maskEmail(email: string | null): string | null {
  if (!email || !email.includes("@")) return email;
  const [u, d] = email.split("@");
  const shown = u.length <= 2 ? `${u[0] || ""}*` : `${u.slice(0, 2)}***`;
  return `${shown}@${d}`;
}

export async function GET(req: Request): Promise<NextResponse> {
  const token = tokenFrom(req);
  if (!token) return NextResponse.json({ ok: false, error: "Missing token." }, { status: 400 });
  try {
    const { row } = await lookup(token);
    if (!row) return NextResponse.json({ ok: false, error: "Link is not valid." }, { status: 404 });
    return NextResponse.json({
      ok: true,
      email: maskEmail(row.to_email),
      channel: "email",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Lookup failed." }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) body = await req.json();
    else {
      const text = await req.text();
      if (text.includes("=")) {
        const params = new URLSearchParams(text);
        body = Object.fromEntries(params.entries());
      }
    }
  } catch {
    body = {};
  }

  const token = tokenFrom(req, body);
  if (!token) return NextResponse.json({ ok: false, error: "Missing token." }, { status: 400 });

  try {
    const { supabase, row } = await lookup(token);
    if (!row) return NextResponse.json({ ok: false, error: "Link is not valid." }, { status: 404 });
    await recordPartnershipOptOut(supabase, {
      email: row.to_email,
      phone: row.to_phone,
      channel: "email",
      source: "email_unsubscribe",
    });
    return NextResponse.json({ ok: true, unsubscribed: true, email: maskEmail(row.to_email) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unsubscribe failed." }, { status: 500 });
  }
}
