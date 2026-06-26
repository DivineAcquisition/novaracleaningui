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
  const pending = (properties || []).filter((p) => !(p.turnover_price != null && Number(p.turnover_price) > 0));

  return NextResponse.json({
    ok: true,
    host: { name: host.name, email: host.email },
    weekStart,
    properties: priced,
    pendingProperties: pending,
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

  let body: {
    action?: string; items?: SlotItem[]; paymentOption?: string;
    property?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Add a property (no login) — host registers a rental from the scheduler.
  // Price stays NULL ("pending pricing") so it can't be booked until an admin
  // sets the per-turnover rate. Capped to keep abuse in check.
  if (body.action === "addProperty") {
    const supabase = getAdminSupabase();
    const { count } = await supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("host_id", host.id);
    if ((count || 0) >= 50) {
      return NextResponse.json({ error: "Property limit reached — contact your account manager." }, { status: 409 });
    }
    const p = (body.property || {}) as Record<string, unknown>;
    const nickname = String(p.nickname || "").trim();
    const address = String(p.address || "").trim();
    if (!nickname && !address) {
      return NextResponse.json({ error: "Add a nickname or address." }, { status: 400 });
    }
    const sqft = p.sqft != null && p.sqft !== "" ? parseInt(String(p.sqft), 10) : null;
    const { data: created, error: addErr } = await supabase
      .from("properties")
      .insert({
        host_id: host.id,
        nickname: nickname || null,
        address: address || null,
        bedrooms: p.bedrooms != null && p.bedrooms !== "" ? parseInt(String(p.bedrooms), 10) : null,
        bathrooms: p.bathrooms != null && p.bathrooms !== "" ? parseFloat(String(p.bathrooms)) : null,
        sqft,
        target_crew_size: sqft ? (sqft >= 2500 ? 3 : 2) : null,
        laundry_included: !!p.laundry_included,
        restock_included: !!p.restock_included,
        access_instructions: String(p.access_instructions || "").trim() || null,
        special_notes: String(p.special_notes || "").trim() || null,
        turnover_price: null,
      })
      .select("id, nickname, address, turnover_price")
      .single();
    if (addErr) return NextResponse.json({ error: addErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, property: created });
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

  if (!host.email) {
    return NextResponse.json({ error: "No email on file to invoice." }, { status: 400 });
  }

  // Build the rows to insert (pending_payment until each invoice is paid).
  const dbRows: Array<Record<string, unknown>> = [];
  const labels: string[] = [];
  for (const it of items) {
    const p = byId.get(it.propertyId);
    if (!p || p.turnover_price == null || Number(p.turnover_price) <= 0) continue;
    if (!it.date) continue;
    const priceCents = Math.round(Number(p.turnover_price) * 100);
    const depositCents = paymentOption === "split" ? Math.floor(priceCents / 2) : priceCents;
    dbRows.push({
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
    labels.push(p.nickname || "Property");
  }
  if (dbRows.length === 0) return NextResponse.json({ error: "No valid priced turnovers selected." }, { status: 400 });

  const { data: created, error: insErr } = await supabase
    .from("turnover_requests")
    .insert(dbRows)
    .select("id, property_id, requested_date, deposit_cents");
  if (insErr || !created) return NextResponse.json({ error: insErr?.message || "Could not create turnovers" }, { status: 500 });

  const stripeKey = await (async () => {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", "STRIPE_SECRET_KEY").maybeSingle();
    return (data?.value as string) || process.env.STRIPE_SECRET_KEY || "";
  })();
  if (!stripeKey) return NextResponse.json({ error: "Payments are not configured." }, { status: 500 });

  // Reuse / create the host's Stripe customer (the card is saved when they pay
  // the invoice — see stripe-webhook invoice.payment_succeeded).
  let customerId = host.stripe_customer_id || "";
  if (!customerId) {
    const cust = await stripeRest("customers", { email: host.email, name: host.name || "" }, stripeKey).catch(() => null);
    customerId = cust?.id || "";
    if (customerId) await supabase.from("hosts").update({ stripe_customer_id: customerId }).eq("id", host.id);
  }
  if (!customerId) return NextResponse.json({ error: "Could not set up billing for this host." }, { status: 502 });

  // One Stripe INVOICE per turnover (collection_method=send_invoice → emailed
  // hosted invoice; paying it stores the card and, via the webhook, books +
  // assigns the turnover). Split bills 50% now; the balance is charged
  // off-session on completion.
  const invoices: Array<Record<string, unknown>> = [];
  for (let i = 0; i < created.length; i++) {
    const row = created[i];
    const label = byId.get(row.property_id as string)?.nickname || labels[i] || "Turnover";
    const amount = Number(row.deposit_cents) || 0;
    const desc = `STR turnover — ${label} on ${row.requested_date}${paymentOption === "split" ? " (50% deposit)" : ""}`;
    try {
      const inv = await stripeRest("invoices", {
        customer: customerId,
        collection_method: "send_invoice",
        days_until_due: "3",
        auto_advance: "false",
        description: desc,
        "metadata[kind]": "turnover",
        "metadata[turnover_id]": String(row.id),
        "metadata[host_id]": String(host.id),
      }, stripeKey);
      await stripeRest("invoiceitems", {
        customer: customerId,
        invoice: String(inv.id),
        amount: String(amount),
        currency: "usd",
        description: desc,
      }, stripeKey);
      const sent = await stripeRest(`invoices/${inv.id}/send`, {}, stripeKey);
      await supabase.from("turnover_requests").update({
        stripe_invoice_id: inv.id,
        stripe_invoice_url: sent.hosted_invoice_url || null,
        invoiced_at: new Date().toISOString(),
      }).eq("id", row.id);
      invoices.push({ turnoverId: row.id, date: row.requested_date, property: label, amountCents: amount, url: sent.hosted_invoice_url || null });
    } catch (e) {
      invoices.push({ turnoverId: row.id, date: row.requested_date, property: label, error: (e as Error).message });
    }
  }

  const okCount = invoices.filter((v) => !v.error).length;
  return NextResponse.json({ ok: true, invoiced: okCount, count: created.length, invoices });
}
