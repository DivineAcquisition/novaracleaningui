// ─── /api/partner-schedule/[token] ────────────────────────────────────────────
//
// Public, token-authenticated weekly scheduler for STR hosts. The token is the
// host's hosts.calendar_token (sent by admin via SMS/email). No login required.
//
//   GET  → { host, properties (priced), weekStart, existing turnovers }
//   POST → create a booking_batch + turnover_requests (pending_payment) for the
//          selected slots and return a Stripe Checkout URL for the total. The
//          existing `turnover_batch` webhook finalizes + assigns after payment.
//
// Payment options: 'full' (100% now) or 'split' (50% now, 50% auto on
// completion). Stripe is called via REST (no server SDK on the Next side); the
// secret is read from app_secrets.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PORTAL_BASE = (
  process.env.NEXT_PUBLIC_PARTNER_PORTAL_URL || "https://app.novaracleaning.com"
).replace(/\/+$/, "");

function mondayOf(d = new Date()): string {
  const x = new Date(d);
  const day = (x.getUTCDay() + 6) % 7; // 0 = Monday
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

async function hostForToken(token: string) {
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("hosts")
    .select("id, name, email, phone, stripe_customer_id, status")
    .eq("calendar_token", token)
    .maybeSingle();
  return data;
}

export async function GET(_req: Request, { params }: { params: { token: string } }): Promise<NextResponse> {
  const token = params.token;
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  const host = await hostForToken(token);
  if (!host) return NextResponse.json({ error: "Invalid scheduler link" }, { status: 404 });

  const supabase = getAdminSupabase();
  const weekStart = mondayOf();
  const weekEnd = new Date(`${weekStart}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const [{ data: properties }, { data: existing }] = await Promise.all([
    supabase.from("properties").select("id, nickname, address, turnover_price").eq("host_id", host.id),
    supabase
      .from("turnover_requests")
      .select("id, property_id, requested_date, window_start, window_end, status")
      .eq("host_id", host.id)
      .gte("requested_date", weekStart)
      .lt("requested_date", weekEndStr)
      .neq("status", "cancelled"),
  ]);

  const priced = (properties || []).filter((p) => p.turnover_price != null && Number(p.turnover_price) > 0);

  return NextResponse.json({
    ok: true,
    host: { name: host.name, email: host.email },
    weekStart,
    properties: priced,
    existing: existing || [],
  });
}

interface SlotItem {
  propertyId: string;
  date: string;
  window_start?: string;
  window_end?: string;
}

async function stripeRest(path: string, params: Record<string, string>, key: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data;
}

export async function POST(req: Request, { params }: { params: { token: string } }): Promise<NextResponse> {
  const token = params.token;
  const host = token ? await hostForToken(token) : null;
  if (!host) return NextResponse.json({ error: "Invalid scheduler link" }, { status: 404 });
  if (host.status === "blocked") return NextResponse.json({ error: "Account is not active." }, { status: 403 });

  let body: { items?: SlotItem[]; paymentOption?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: "Pick at least one turnover." }, { status: 400 });
  const paymentOption = body.paymentOption === "split" ? "split" : "full";

  const supabase = getAdminSupabase();
  const { data: props } = await supabase
    .from("properties")
    .select("id, nickname, turnover_price, host_id")
    .eq("host_id", host.id);
  const byId = new Map((props || []).map((p) => [p.id as string, p]));

  // Validate + price each slot.
  const rows: Array<Record<string, unknown>> = [];
  let totalCents = 0;
  for (const it of items) {
    const p = byId.get(it.propertyId);
    if (!p || p.turnover_price == null || Number(p.turnover_price) <= 0) continue;
    if (!it.date) continue;
    const priceCents = Math.round(Number(p.turnover_price) * 100);
    const depositCents = paymentOption === "split" ? Math.floor(priceCents / 2) : priceCents;
    totalCents += depositCents;
    rows.push({
      property_id: it.propertyId,
      host_id: host.id,
      requested_date: it.date,
      window_start: it.window_start || "11:00",
      window_end: it.window_end || "15:00",
      price: Number(p.turnover_price),
      status: "pending_payment",
      payment_option: paymentOption,
      deposit_cents: depositCents,
      balance_cents: priceCents - depositCents,
    });
  }
  if (rows.length === 0) return NextResponse.json({ error: "No valid priced turnovers selected." }, { status: 400 });

  const weekStart = mondayOf(new Date(`${rows[0].requested_date}T00:00:00Z`));
  const totalAmount = rows.reduce((s, r) => s + Number(r.price), 0);

  // Create the batch, then the turnover rows linked to it.
  const { data: batch, error: batchErr } = await supabase
    .from("booking_batches")
    .insert({
      host_id: host.id,
      week_start: weekStart,
      source: "manual",
      turnover_count: rows.length,
      total_amount: totalAmount,
      status: "pending_payment",
    })
    .select("id")
    .single();
  if (batchErr || !batch) return NextResponse.json({ error: batchErr?.message || "Could not create batch" }, { status: 500 });

  const { error: insErr } = await supabase
    .from("turnover_requests")
    .insert(rows.map((r) => ({ ...r, batch_id: batch.id })));
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // Stripe Checkout for the deposit total (full or 50%).
  const stripeKey = await (async () => {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", "STRIPE_SECRET_KEY").maybeSingle();
    return (data?.value as string) || process.env.STRIPE_SECRET_KEY || "";
  })();
  if (!stripeKey) return NextResponse.json({ error: "Payments are not configured." }, { status: 500 });

  // Reuse / create the host's Stripe customer so the card is saved.
  let customerId = host.stripe_customer_id || "";
  if (!customerId && host.email) {
    const cust = await stripeRest("customers", { email: host.email, name: host.name || "" }, stripeKey).catch(() => null);
    customerId = cust?.id || "";
    if (customerId) await supabase.from("hosts").update({ stripe_customer_id: customerId }).eq("id", host.id);
  }

  const label =
    paymentOption === "split"
      ? `Weekly turnovers (${rows.length}) deposit (50%) — week of ${weekStart}`
      : `Weekly turnovers (${rows.length}) — week of ${weekStart}`;
  const checkoutParams: Record<string, string> = {
    mode: "payment",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": label,
    "line_items[0][price_data][unit_amount]": String(totalCents),
    "line_items[0][quantity]": "1",
    success_url: `${PORTAL_BASE}/partner/turnover/batch-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PORTAL_BASE}/partner/schedule/${token}`,
    "payment_intent_data[setup_future_usage]": "off_session",
    "metadata[kind]": "turnover_batch",
    "metadata[batch_id]": batch.id,
    "metadata[host_id]": host.id,
  };
  if (customerId) checkoutParams.customer = customerId;
  else if (host.email) checkoutParams.customer_email = host.email;

  try {
    const session = await stripeRest("checkout/sessions", checkoutParams, stripeKey);
    await supabase.from("booking_batches").update({ stripe_checkout_session_id: session.id }).eq("id", batch.id);
    return NextResponse.json({ ok: true, url: session.url, batchId: batch.id, count: rows.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
