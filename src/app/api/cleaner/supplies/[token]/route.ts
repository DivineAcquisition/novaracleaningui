// Tokenized supply checklist — no login. Cleaner marks which kit items they own.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  SUPPLY_ITEMS,
  SUPPLY_READY_PERCENT,
  scoreSupplyInventory,
  type SupplyInventory,
} from "@/lib/cleaner-supplies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

async function loadByToken(token: string) {
  const supabase = getAdminSupabase();
  const { data, error } = await (supabase.from as any)("cleaners")
    .select(
      "id, first_name, last_name, email, status, supply_token_expires_at, supply_inventory, supply_checklist_submitted_at, ob_supplies_checklist_viewed",
    )
    .eq("supply_token", token)
    .maybeSingle();
  return { supabase, cleaner: data, error };
}

export async function GET(_req: Request, ctx: Ctx): Promise<NextResponse> {
  const { token: raw } = await ctx.params;
  const token = String(raw || "").trim();
  if (token.length < 16) {
    return NextResponse.json({ error: "Invalid supply link.", reason: "invalid" }, { status: 400 });
  }

  const { cleaner, error } = await loadByToken(token);
  if (error) {
    return NextResponse.json({ error: error.message, reason: "error" }, { status: 500 });
  }
  if (!cleaner) {
    return NextResponse.json(
      { error: "This supply link isn't valid — ask Novara for a fresh one.", reason: "invalid" },
      { status: 404 },
    );
  }
  if (String(cleaner.status) === "terminated") {
    return NextResponse.json(
      { error: "This account is no longer active.", reason: "terminated" },
      { status: 409 },
    );
  }
  const expired =
    cleaner.supply_token_expires_at &&
    new Date(String(cleaner.supply_token_expires_at)).getTime() < Date.now();
  if (expired) {
    return NextResponse.json(
      { error: "This supply link has expired. Ask Novara to resend it.", reason: "expired" },
      { status: 410 },
    );
  }

  const inventory = (cleaner.supply_inventory || {}) as SupplyInventory;
  const score = scoreSupplyInventory(inventory);

  return NextResponse.json({
    ok: true,
    cleaner: {
      firstName: cleaner.first_name || "",
      name: `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim(),
    },
    items: SUPPLY_ITEMS,
    inventory,
    score: {
      ...score,
      requiredPercent: SUPPLY_READY_PERCENT,
    },
    submittedAt: cleaner.supply_checklist_submitted_at || null,
    expiresAt: cleaner.supply_token_expires_at || null,
  });
}

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const { token: raw } = await ctx.params;
  const token = String(raw || "").trim();
  if (token.length < 16) {
    return NextResponse.json({ error: "Invalid supply link.", reason: "invalid" }, { status: 400 });
  }

  let body: { owned?: Record<string, boolean> };
  try {
    body = (await req.json()) as { owned?: Record<string, boolean> };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { supabase, cleaner, error } = await loadByToken(token);
  if (error) {
    return NextResponse.json({ error: error.message, reason: "error" }, { status: 500 });
  }
  if (!cleaner) {
    return NextResponse.json(
      { error: "This supply link isn't valid — ask Novara for a fresh one.", reason: "invalid" },
      { status: 404 },
    );
  }
  if (String(cleaner.status) === "terminated") {
    return NextResponse.json(
      { error: "This account is no longer active.", reason: "terminated" },
      { status: 409 },
    );
  }
  const expired =
    cleaner.supply_token_expires_at &&
    new Date(String(cleaner.supply_token_expires_at)).getTime() < Date.now();
  if (expired) {
    return NextResponse.json(
      { error: "This supply link has expired. Ask Novara to resend it.", reason: "expired" },
      { status: 410 },
    );
  }

  const allowed = new Set(SUPPLY_ITEMS.map((i) => i.id));
  const ownedIn = body.owned && typeof body.owned === "object" ? body.owned : {};
  const inventory: SupplyInventory = {};
  for (const [id, val] of Object.entries(ownedIn)) {
    if (!allowed.has(id)) continue;
    inventory[id] = val === true;
  }

  const now = new Date().toISOString();
  const score = scoreSupplyInventory(inventory);

  const { error: upErr } = await (supabase.from as any)("cleaners")
    .update({
      supply_inventory: inventory,
      supply_checklist_submitted_at: now,
      ob_supplies_checklist_viewed: true,
      ob_supplies_checklist_viewed_at: now,
      updated_at: now,
    })
    .eq("id", cleaner.id);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  await supabase.from("events").insert({
    event_type: "cleaner.supply_checklist_submitted",
    cleaner_id: cleaner.id,
    source: "cleaner-supplies-token",
    summary:
      `${cleaner.first_name || "Cleaner"} submitted supply checklist — ` +
      `${score.ownedNeeded}/${score.totalNeeded} job-needed (${score.percent}%, ready=${score.ready})`,
    data: {
      owned_needed: score.ownedNeeded,
      total_needed: score.totalNeeded,
      percent: score.percent,
      ready: score.ready,
      threshold: score.threshold,
      inventory,
    },
  }).then(() => undefined, () => undefined);

  return NextResponse.json({
    ok: true,
    inventory,
    score: { ...score, requiredPercent: SUPPLY_READY_PERCENT },
    submittedAt: now,
  });
}
