// ─── POST /api/commercial-intake ──────────────────────────────────────────────
//
// Public intake endpoint behind commercial.novaracleaning.com. Turns a typed
// submission (Commercial / Office / STR) into:
//
//   1. A typed lead in public.leads (deduped: a repeat inquiry from the same
//      email UPDATES the open lead instead of duplicating).
//   2. Commercial/Office → an upserted business_accounts row (status
//      'prospect'; Office = commercial with facility type Office).
//   3. Airtable: Clients upsert on email (Client Type, Lead Source, Lifecycle
//      "Lead") + a linked Commercial Accounts row (Account Status "Prospect")
//      for commercial/office. Best-effort — Airtable being down never loses
//      the lead.
//   4. A public.events row (partner.lead.created) → Discord Revenue channel.
//      High-intent signals (10k+ sqft, 3+ locations/properties, ASAP timing)
//      are flagged priority in the alert.
//
// NEVER prices. Email is the identity key everywhere.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { primeAirtablePat } from "@/lib/airtable/sources/prime-pat";
import { upsertOne } from "@/lib/airtable/client";
import { CLIENT_FIELDS, TABLES } from "@/lib/airtable/schema";
import { syncCommercialAccount } from "@/lib/airtable/mappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IntakeBody {
  type?: "commercial" | "office" | "str";
  businessName?: string;
  contactName?: string;
  role?: string;
  email?: string;
  phone?: string;
  city?: string;
  numLocations?: string;
  facilityType?: string;
  sqft?: string;
  frequency?: string;
  currentSituation?: string;
  numProperties?: string;
  bedsBaths?: string;
  turnoverFrequency?: string;
  entityType?: string;
  timing?: string;
}

const s = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
const n = (v: unknown) => {
  const num = parseInt(String(v ?? ""), 10);
  return Number.isFinite(num) && num > 0 ? num : null;
};

export async function POST(req: Request): Promise<NextResponse> {
  let body: IntakeBody;
  try {
    body = (await req.json()) as IntakeBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const type = body.type === "office" ? "office" : body.type === "str" ? "str" : body.type === "commercial" ? "commercial" : null;
  const email = s(body.email, 200).toLowerCase();
  const contactName = s(body.contactName, 120);
  const phoneDigits = s(body.phone, 30).replace(/\D/g, "");

  if (!type) return NextResponse.json({ ok: false, error: "Pick a partnership type." }, { status: 400 });
  if (!/.+@.+\..+/.test(email)) return NextResponse.json({ ok: false, error: "A valid email is required." }, { status: 400 });
  if (!contactName) return NextResponse.json({ ok: false, error: "Your name is required." }, { status: 400 });
  if (phoneDigits.length < 10) return NextResponse.json({ ok: false, error: "A valid phone number is required." }, { status: 400 });

  const isStr = type === "str";
  const businessName = s(body.businessName, 160);
  const sqft = n(body.sqft);
  const numLocations = n(body.numLocations);
  const numProperties = n(body.numProperties);
  const timing = s(body.timing, 60);

  // High-intent priority flag.
  const priority =
    (sqft !== null && sqft >= 10000) ||
    (numLocations !== null && numLocations >= 3) ||
    (numProperties !== null && numProperties >= 3) ||
    timing === "As soon as possible";

  const details: Record<string, unknown> = {
    type,
    role: s(body.role, 100) || undefined,
    city: s(body.city, 100) || undefined,
    facility_type: s(body.facilityType, 60) || undefined,
    frequency: s(body.frequency, 60) || undefined,
    current_situation: s(body.currentSituation, 1000) || undefined,
    num_locations: numLocations ?? undefined,
    sqft: sqft ?? undefined,
    num_properties: numProperties ?? undefined,
    beds_baths: s(body.bedsBaths, 60) || undefined,
    turnover_frequency: s(body.turnoverFrequency, 60) || undefined,
    entity_type: s(body.entityType, 30) || undefined,
    timing: timing || undefined,
  };

  const supabase = getAdminSupabase();
  const [firstName, ...rest] = contactName.split(/\s+/);
  const lastName = rest.join(" ") || null;
  const typeLabel = type === "str" ? "Airbnb/STR partnership" : type === "office" ? "Office cleaning" : "Commercial cleaning";

  try {
    // ── 1. Typed lead, deduped on email ─────────────────────────────────
    const { data: existing } = await supabase
      .from("leads")
      .select("id, status")
      .ilike("email", email)
      .eq("source", "commercial_intake")
      .not("status", "in", "(won,lost,closed)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const leadPatch = {
      first_name: firstName,
      last_name: lastName,
      email,
      phone: phoneDigits,
      source: "commercial_intake",
      channel: "commercial.novaracleaning.com",
      status: "new",
      lead_score: priority ? "hot" : "warm",
      service_type: isStr ? "str_turnover" : "commercial",
      property_type: isStr ? "str" : (s(body.facilityType, 60) || type),
      sqft: sqft,
      frequency: s(body.frequency || body.turnoverFrequency, 60) || null,
      urgency: timing || null,
      notes: [
        `Type: ${typeLabel}`,
        businessName ? `Business: ${businessName}` : null,
        details.role ? `Role: ${details.role}` : null,
        numLocations ? `Locations: ${numLocations}` : null,
        numProperties ? `Properties: ${numProperties}` : null,
        details.beds_baths ? `Typical size: ${details.beds_baths}` : null,
        details.entity_type ? `Entity: ${details.entity_type}` : null,
        details.current_situation ? `Situation: ${details.current_situation}` : null,
      ].filter(Boolean).join("\n"),
    };

    let leadId: string | null = existing?.id ?? null;
    if (leadId) {
      await supabase.from("leads").update(leadPatch).eq("id", leadId);
    } else {
      const { data: inserted } = await supabase.from("leads").insert(leadPatch).select("id").maybeSingle();
      leadId = inserted?.id ?? null;
    }

    // ── 2. Commercial/Office → business_accounts prospect (email-deduped) ──
    let accountId: string | null = null;
    if (!isStr) {
      const { data: acct } = await supabase
        .from("business_accounts")
        .select("id")
        .ilike("email", email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const acctPatch = {
        account_type: type === "office" ? "office" : "commercial",
        business_name: businessName || `${contactName}'s business`,
        contact_name: contactName,
        email,
        phone: phoneDigits,
        city: s(body.city, 100) || null,
        facility_type: s(body.facilityType, 60) || (type === "office" ? "Office" : null),
        square_footage: sqft,
        recurring_frequency: s(body.frequency, 60) || null,
        num_locations: numLocations,
        source: "commercial_intake",
        lead_details: details,
      };
      if (acct?.id) {
        accountId = acct.id;
        await supabase.from("business_accounts").update(acctPatch).eq("id", acct.id);
      } else {
        const { data: created } = await supabase
          .from("business_accounts")
          .insert({ ...acctPatch, status: "prospect" })
          .select("id")
          .maybeSingle();
        accountId = created?.id ?? null;
      }
    }

    // ── 3. Airtable (best-effort — never blocks the lead) ───────────────
    try {
      await primeAirtablePat();
      await upsertOne(TABLES.clients, [CLIENT_FIELDS.email], {
        [CLIENT_FIELDS.email]: email,
        [CLIENT_FIELDS.clientName]: contactName,
        [CLIENT_FIELDS.clientType]: isStr ? "STR Host" : "Commercial",
        [CLIENT_FIELDS.company]: businessName || undefined,
        [CLIENT_FIELDS.phone]: phoneDigits,
        [CLIENT_FIELDS.leadSource]: "Commercial Intake",
        [CLIENT_FIELDS.lifecycleStage]: "Lead",
      });
      if (!isStr && businessName) {
        await syncCommercialAccount({
          businessName,
          accountType: type === "office" ? "Office" : "Commercial",
          accountStatus: "Prospect",
          serviceFrequency: s(body.frequency, 60) || undefined,
          decisionMakerEmail: email,
        });
      }
    } catch (e) {
      console.error("[commercial-intake] airtable best-effort failed:", (e as Error).message);
    }

    // ── 4. Team alert (Discord via events bus) ──────────────────────────
    await supabase.from("events").insert({
      event_type: "partner.lead.created",
      lead_id: leadId,
      source: "commercial-intake",
      summary:
        `${priority ? "🔥 PRIORITY — " : ""}New ${typeLabel} lead: ${contactName}` +
        `${businessName ? ` (${businessName})` : ""} · ${email} · ${phoneDigits}` +
        `${sqft ? ` · ~${sqft.toLocaleString()} sqft` : ""}` +
        `${numLocations ? ` · ${numLocations} locations` : ""}` +
        `${numProperties ? ` · ${numProperties} properties` : ""}` +
        `${timing ? ` · ${timing}` : ""}\nReview in Admin → Partnerships.`,
      data: { lead_id: leadId, business_account_id: accountId, ...details, priority },
    }).then(() => undefined, () => undefined);

    return NextResponse.json({ ok: true, leadId, accountId });
  } catch (err) {
    console.error("[commercial-intake]", (err as Error).message);
    return NextResponse.json({ ok: false, error: "Could not submit — please try again." }, { status: 500 });
  }
}
