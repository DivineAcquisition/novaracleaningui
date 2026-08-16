// ─── /api/bookings/pay-page-addons ───────────────────────────────────────────
//
// Lets the customer adjust their add-ons from the deposit pay page
// (/pay/<token>) before they pay.
//
// Why here and not in booking-pay-page: this needs to reprice the booking, and
// keeping it as its own small route means the pricing rules live next to the
// catalogue they come from (src/lib/pricing.ts) instead of a second Deno copy
// that can drift.
//
//   GET  ?token=…  → catalogue + what's currently selected
//   POST { token, addOns } → re-price and save
//
// Guard rails, all enforced server-side because the page is public:
//   * the pay_page_token is the credential and scopes everything to one booking
//   * prices come from OUR catalogue, never from the request body
//   * once the deposit is paid the selection is frozen — changing the total
//     after payment would silently alter what the pre-auth hold is for
//   * Move-In/Out includes fridge + oven, so they are never charged there

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { ADD_ONS, OPS_ONLY_ADD_ON_IDS, type AddOnId } from "@/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS =
  "id, status, service_type, add_ons, total_estimate_cents, deposit_cents, payment_received_at, payment_option";

interface Row {
  id: string;
  status: string | null;
  service_type: string | null;
  add_ons: string[] | null;
  total_estimate_cents: number | null;
  deposit_cents: number | null;
  payment_received_at: string | null;
  payment_option: string | null;
}

/** Fridge and oven ship free with a move-in/out clean. */
function isFreeForService(id: string, serviceType: string | null): boolean {
  return serviceType === "moveInOut" && (id === "fridge" || id === "oven");
}

function priceCents(id: string, serviceType: string | null): number {
  if (isFreeForService(id, serviceType)) return 0;
  const entry = ADD_ONS[id as AddOnId];
  return entry ? entry.price * 100 : 0;
}

/** Throws on a query error — "no such link" and "our query is broken" must not
 *  collapse into the same answer for the customer. */
async function load(token: string): Promise<Row | null> {
  if (!token || token.length < 16) return null;
  const supabase = getAdminSupabase();
  const { data, error } = await (supabase.from as never as (t: string) => {
    select: (c: string) => {
      eq: (k: string, v: string) => {
        maybeSingle: () => Promise<{ data: Row | null; error: { message: string } | null }>;
      };
    };
  })("bookings")
    .select(COLS)
    .eq("pay_page_token", token)
    .maybeSingle();
  if (error) throw new Error(`booking lookup failed: ${error.message}`);
  return data || null;
}

/** Shared wrapper so both handlers report a broken query as a 500, not a 404. */
async function loadOrRespond(
  token: string,
): Promise<{ booking: Row | null; failure: NextResponse | null }> {
  try {
    return { booking: await load(token), failure: null };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[pay-page-addons] lookup failed", err);
    return {
      booking: null,
      failure: NextResponse.json(
        { error: "We couldn't load your booking just now. Please try again in a moment." },
        { status: 500 },
      ),
    };
  }
}

function catalogue(serviceType: string | null, selected: string[]) {
  return (Object.keys(ADD_ONS) as AddOnId[])
    .filter((id) => !OPS_ONLY_ADD_ON_IDS.has(id) || selected.includes(id))
    .map((id) => ({
      id,
      label: ADD_ONS[id].label,
      note: ADD_ONS[id].note,
      priceCents: priceCents(id, serviceType),
      includedFree: isFreeForService(id, serviceType),
      selected: selected.includes(id),
    }));
}

export async function GET(req: Request): Promise<NextResponse> {
  const token = new URL(req.url).searchParams.get("token") || "";
  const { booking, failure } = await loadOrRespond(token);
  if (failure) return failure;
  if (!booking) return NextResponse.json({ error: "Invalid link." }, { status: 404 });

  const selected = (booking.add_ons || []).filter(Boolean);
  return NextResponse.json({
    ok: true,
    locked: !!booking.payment_received_at,
    serviceType: booking.service_type,
    selected,
    addOns: catalogue(booking.service_type, selected),
    totalCents: booking.total_estimate_cents || 0,
    depositCents: booking.deposit_cents || 0,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: { token?: string; addOns?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const token = String(body.token || "");
  const { booking, failure } = await loadOrRespond(token);
  if (failure) return failure;
  if (!booking) return NextResponse.json({ error: "Invalid link." }, { status: 404 });
  if (String(booking.status || "").toLowerCase() === "cancelled") {
    return NextResponse.json({ error: "This booking was cancelled." }, { status: 410 });
  }
  // Frozen after payment: the deposit and the pre-auth hold are both derived
  // from the total, so moving it afterwards would quietly change what the
  // customer authorised.
  if (booking.payment_received_at) {
    return NextResponse.json(
      { error: "Your deposit is already paid, so this booking can't be changed here. Text us and we'll sort it." },
      { status: 409 },
    );
  }

  const requested = Array.isArray(body.addOns) ? body.addOns.map(String) : [];
  const prevAddOns = (booking.add_ons || []).filter(Boolean);
  const nextAddOns = [...new Set(requested)].filter((id) => {
    if (!(id in ADD_ONS)) return false;
    if (OPS_ONLY_ADD_ON_IDS.has(id) && !prevAddOns.includes(id)) return false;
    return true;
  });
  const prevCents = prevAddOns.reduce((s, id) => s + priceCents(id, booking.service_type), 0);
  const nextCents = nextAddOns.reduce((s, id) => s + priceCents(id, booking.service_type), 0);
  const deltaCents = nextCents - prevCents;

  const prevTotal = Number(booking.total_estimate_cents || 0);
  const newTotal = Math.max(0, prevTotal + deltaCents);

  // Keep the deposit at the same share of the total it already was, so the
  // "50% now / 50% after" promise on the page stays true after a change.
  const prevDeposit = Number(booking.deposit_cents || 0);
  const ratio = prevTotal > 0 ? prevDeposit / prevTotal : 0.5;
  const newDeposit = prevDeposit > 0 ? Math.round(newTotal * ratio) : 0;

  const supabase = getAdminSupabase();
  const { error } = await supabase
    .from("bookings")
    .update({
      add_ons: nextAddOns,
      total_estimate_cents: newTotal,
      ...(prevDeposit > 0 ? { deposit_cents: newDeposit } : {}),
    })
    .eq("id", booking.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase
    .from("events")
    .insert({
      event_type: "booking.addons_updated_by_customer",
      booking_id: booking.id,
      source: "pay_page",
      summary:
        `Customer updated add-ons on the pay page: ` +
        `${prevAddOns.join(", ") || "none"} → ${nextAddOns.join(", ") || "none"} ` +
        `(${deltaCents >= 0 ? "+" : "−"}$${Math.abs(deltaCents / 100).toFixed(2)}).`,
      data: { previous: prevAddOns, next: nextAddOns, delta_cents: deltaCents },
    })
    .then(() => undefined, () => undefined);

  return NextResponse.json({
    ok: true,
    selected: nextAddOns,
    addOns: catalogue(booking.service_type, nextAddOns),
    totalCents: newTotal,
    depositCents: prevDeposit > 0 ? newDeposit : 0,
    remainingCents: Math.max(0, newTotal - (prevDeposit > 0 ? newDeposit : 0)),
    deltaCents,
  });
}
