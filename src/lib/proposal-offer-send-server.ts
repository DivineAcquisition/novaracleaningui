// ─── Server: walk-in STR and property-manager offer send ───────────────────
//
// Office and commercial already mint a proposal document via create_draft.
// STR and PM mail a tokenized onboarding link (agreement + payment) after
// the host/portfolio and priced properties exist.

import { startHostOnboardingSession } from "@/lib/host-onboarding/admin";
import { startPmOnboardingSession } from "@/lib/property-manager/onboarding/admin";
import { approveUnit, registerUnit } from "@/lib/property-manager/registry";
import { isValidProposalEmail } from "@/lib/commercial-proposal-send";
import { pmOfferRequirements, strOfferRequirements } from "@/lib/proposal-offer-send";

// eslint-disable-next-line
type Admin = any;

function clip(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeAddress(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function siteLine(input: { address?: string; city?: string; state?: string; zip?: string }): string {
  return [input.address, input.city, input.state, input.zip].map((p) => clip(p, 200)).filter(Boolean).join(", ");
}

export interface StrOfferProperty {
  propertyId?: string;
  nickname?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  sqft?: number | string | null;
  turnoverDollars?: number | string | null;
  laundryIncluded?: boolean;
}

export interface SendStrOfferInput {
  hostId?: string;
  hostName: string;
  email: string;
  phone?: string;
  actorName: string;
  send?: boolean;
  properties: StrOfferProperty[];
}

export async function sendStrOffer(supabase: Admin, input: SendStrOfferInput) {
  const hostName = clip(input.hostName, 120);
  const email = clip(input.email, 200).toLowerCase();
  const phone = clip(input.phone, 40).replace(/\D/g, "");
  const properties = (input.properties || []).map((p) => ({
    ...p,
    nickname: clip(p.nickname, 80),
    address: siteLine(p) || clip(p.address, 200),
    turnoverDollars: num(p.turnoverDollars),
  }));
  const missing = strOfferRequirements({
    hostName,
    email,
    properties: properties.map((p) => ({
      nickname: p.nickname,
      address: p.address,
      turnoverDollars: p.turnoverDollars,
    })),
  });
  if (missing.length) {
    return { ok: false, status: 400, message: `Still needed: ${missing.join(", ")}.` };
  }

  let hostId = clip(input.hostId, 80) || "";
  if (hostId) {
    const { data: existing } = await supabase.from("hosts").select("id").eq("id", hostId).maybeSingle();
    if (!existing?.id) hostId = "";
  }
  if (!hostId) {
    const { data: byEmail } = await supabase
      .from("hosts")
      .select("id")
      .ilike("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    hostId = byEmail?.id ? String(byEmail.id) : "";
  }

  if (hostId) {
    await supabase.from("hosts").update({
      name: hostName,
      email,
      phone: phone || null,
    }).eq("id", hostId);
  } else {
    const { data: created, error } = await supabase
      .from("hosts")
      .insert({
        name: hostName,
        email,
        phone: phone || null,
        status: "active",
      })
      .select("id")
      .maybeSingle();
    if (error || !created?.id) {
      return { ok: false, status: 400, message: error?.message || "Could not create the host." };
    }
    hostId = String(created.id);
  }

  const { data: existingProps } = await supabase
    .from("properties")
    .select("id, address")
    .eq("host_id", hostId);
  const byAddress = new Map(
    (existingProps || []).map((row: { id: string; address?: string }) => [normalizeAddress(row.address), String(row.id)]),
  );

  for (const property of properties) {
    const key = normalizeAddress(property.address);
    const patch = {
      host_id: hostId,
      nickname: property.nickname || clip(property.address, 80) || null,
      address: property.address,
      bedrooms: num(property.bedrooms),
      bathrooms: num(property.bathrooms),
      sqft: num(property.sqft),
      turnover_price: property.turnoverDollars,
      laundry_included: property.laundryIncluded === true,
    };
    const existingId = clip(property.propertyId, 80) || byAddress.get(key) || "";
    if (existingId) {
      const { error } = await supabase.from("properties").update(patch).eq("id", existingId);
      if (error) return { ok: false, status: 400, message: error.message };
    } else {
      const { data, error } = await supabase.from("properties").insert(patch).select("id").maybeSingle();
      if (error || !data?.id) return { ok: false, status: 400, message: error?.message || "Could not save a property." };
      byAddress.set(key, String(data.id));
    }
  }

  const started = await startHostOnboardingSession(supabase, {
    hostId,
    actorName: input.actorName,
    recipientName: hostName,
    recipientEmail: email,
    recipientPhone: phone || null,
    send: input.send !== false,
  });
  if (!started.ok) {
    return { ok: false, status: started.status || 400, message: started.message || "Could not send host onboarding." };
  }
  return {
    ok: true,
    status: 200,
    flow: "str" as const,
    hostId,
    link: started.link || null,
    emailed: started.emailed === true,
    texted: started.texted === true,
    sessionId: started.sessionId || null,
  };
}

export interface PmOfferUnit {
  unitId?: string;
  nickname?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  sqft?: number | string | null;
  moveOutDollars?: number | string | null;
  moveInDollars?: number | string | null;
  standardDollars?: number | string | null;
}

export interface SendPmOfferInput {
  pmAccountId?: string;
  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
  actorName: string;
  send?: boolean;
  units: PmOfferUnit[];
}

function dollarsToCents(v: unknown): number | null {
  const n = num(v);
  if (n == null || n <= 0) return null;
  return Math.round(n * 100);
}

export async function sendPmOffer(supabase: Admin, input: SendPmOfferInput) {
  const companyName = clip(input.companyName, 200);
  const contactName = clip(input.contactName, 120);
  const email = clip(input.email, 200).toLowerCase();
  const phone = clip(input.phone, 40);
  const units = (input.units || []).map((u) => ({
    ...u,
    nickname: clip(u.nickname, 120),
    address: siteLine(u) || clip(u.address, 300),
    moveOutCents: dollarsToCents(u.moveOutDollars),
    moveInCents: dollarsToCents(u.moveInDollars),
    standardCents: dollarsToCents(u.standardDollars),
  }));
  const missing = pmOfferRequirements({
    companyName,
    contactName,
    email,
    units: units.map((u) => ({
      nickname: u.nickname,
      address: u.address,
      priced: !!(u.moveOutCents && u.moveInCents && u.standardCents)
        || clip(u.address, 300).length >= 8,
    })),
  });
  if (missing.length) {
    return { ok: false, status: 400, message: `Still needed: ${missing.join(", ")}.` };
  }
  if (!isValidProposalEmail(email)) {
    return { ok: false, status: 400, message: "A valid contact email is required." };
  }

  let pmAccountId = clip(input.pmAccountId, 80) || "";
  if (pmAccountId) {
    const { data: existing } = await supabase
      .from("property_manager_accounts")
      .select("id")
      .eq("id", pmAccountId)
      .maybeSingle();
    if (!existing?.id) pmAccountId = "";
  }
  if (!pmAccountId) {
    const { data: byEmail } = await supabase
      .from("property_manager_accounts")
      .select("id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    pmAccountId = byEmail?.id ? String(byEmail.id) : "";
  }

  if (pmAccountId) {
    await supabase.from("property_manager_accounts").update({
      company_name: companyName,
      contact_name: contactName,
      email,
      phone: phone || null,
    }).eq("id", pmAccountId);
  } else {
    const { data: created, error } = await supabase
      .from("property_manager_accounts")
      .insert({
        company_name: companyName,
        contact_name: contactName,
        email,
        phone: phone || null,
        created_by_name: input.actorName,
      })
      .select("id")
      .maybeSingle();
    if (error || !created?.id) {
      return { ok: false, status: 400, message: error?.message || "Could not create the property manager account." };
    }
    pmAccountId = String(created.id);
  }

  const { data: existingUnits } = await supabase
    .from("property_manager_units")
    .select("id, address")
    .eq("pm_account_id", pmAccountId)
    .neq("status", "inactive");
  const unitByAddress = new Map(
    (existingUnits || []).map((row: { id: string; address?: string }) => [normalizeAddress(row.address), String(row.id)]),
  );

  for (const unit of units) {
    const existingUnitId =
      clip(unit.unitId, 80) || String(unitByAddress.get(normalizeAddress(unit.address)) ?? "");
    if (existingUnitId) {
      if (unit.moveOutCents && unit.moveInCents && unit.standardCents) {
        const priced = await approveUnit(supabase, {
          unitId: existingUnitId,
          sqft: num(unit.sqft),
          bedrooms: num(unit.bedrooms),
          bathrooms: num(unit.bathrooms),
          zipCode: clip(unit.zip, 12) || null,
          manualRates: {
            move_out: unit.moveOutCents,
            move_in: unit.moveInCents,
            standard: unit.standardCents,
          },
          actorName: input.actorName,
          reviewNote: "Updated from Proposals → Send",
        });
        if (!priced.ok) {
          return { ok: false, status: priced.status || 400, message: priced.message };
        }
      }
      continue;
    }
    const registered = await registerUnit(supabase, {
      pmAccountId,
      unitLabel: unit.nickname || null,
      address: unit.address,
      city: clip(unit.city, 120) || null,
      state: clip(unit.state, 40) || null,
      zipCode: clip(unit.zip, 12) || null,
      sqft: num(unit.sqft),
      bedrooms: num(unit.bedrooms),
      bathrooms: num(unit.bathrooms),
      source: "admin",
      actorName: input.actorName,
    });
    if (!registered.ok || !registered.unitId) {
      return { ok: false, status: registered.status || 400, message: registered.message || "Could not register a unit." };
    }
    unitByAddress.set(normalizeAddress(unit.address), registered.unitId);
    if (registered.autoPriced) continue;
    const manual = {
      move_out: unit.moveOutCents ?? undefined,
      move_in: unit.moveInCents ?? undefined,
      standard: unit.standardCents ?? undefined,
    };
    if (!manual.move_out || !manual.move_in || !manual.standard) {
      return {
        ok: false,
        status: 409,
        message: registered.message || `${unit.nickname || unit.address} could not auto-price. Enter Move-Out, Move-In, and Standard rates.`,
      };
    }
    const priced = await approveUnit(supabase, {
      unitId: registered.unitId,
      sqft: num(unit.sqft),
      bedrooms: num(unit.bedrooms),
      bathrooms: num(unit.bathrooms),
      zipCode: clip(unit.zip, 12) || null,
      manualRates: manual,
      actorName: input.actorName,
      reviewNote: "Set from Proposals → Send",
    });
    if (!priced.ok) {
      return { ok: false, status: priced.status || 400, message: priced.message };
    }
  }

  const started = await startPmOnboardingSession(supabase, {
    pmAccountId,
    actorName: input.actorName,
    recipientName: contactName,
    recipientEmail: email,
    recipientPhone: phone || null,
    send: input.send !== false,
  });
  if (!started.ok) {
    return { ok: false, status: started.status || 400, message: started.message || "Could not send property-manager onboarding." };
  }
  return {
    ok: true,
    status: 200,
    flow: "property_manager" as const,
    pmAccountId,
    link: started.link || null,
    emailed: started.emailed === true,
    texted: started.texted === true,
    sessionId: started.sessionId || null,
    unitCount: started.unitCount || units.length,
  };
}

export async function searchStrHosts(supabase: Admin, q: string) {
  let query = supabase
    .from("hosts")
    .select("id, name, email, phone, status")
    .order("created_at", { ascending: false })
    .limit(20);
  const term = clip(q, 80);
  if (term) {
    query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%`);
  }
  const { data: hosts, error } = await query;
  if (error) return { ok: false as const, status: 400, message: error.message };
  const ids = (hosts || []).map((h: { id: string }) => h.id);
  const { data: props } = ids.length
    ? await supabase
      .from("properties")
      .select("id, host_id, nickname, address, bedrooms, bathrooms, sqft, turnover_price, laundry_included")
      .in("host_id", ids)
    : { data: [] };
  const byHost = new Map<string, Array<Record<string, unknown>>>();
  for (const row of props || []) {
    const hid = String((row as { host_id: string }).host_id);
    byHost.set(hid, [...(byHost.get(hid) || []), row as Record<string, unknown>]);
  }
  return {
    ok: true as const,
    hosts: (hosts || []).map((h: { id: string; name?: string; email?: string; phone?: string; status?: string }) => ({
      ...h,
      properties: byHost.get(h.id) || [],
    })),
  };
}
