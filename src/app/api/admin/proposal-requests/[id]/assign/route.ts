// Assign a walkthrough-eligible contractor as Walkthrough Agent.
//
// Ranking is the same spirit as job dispatch: zone/proximity, availability,
// Novara Score. Assignment is paid work — a walkthrough_payouts row is
// written whether or not the proposal later converts. On assign: walkthrough
// → scheduled, requester notified of the date, agent gets the tokenized
// checklist by email AND SMS.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  loadProposalSettings,
  sendProposalEmail,
  sendProposalSms,
  tokenExpiryIso,
  tokenForWalkthrough,
} from "@/lib/proposal-request-server";
import {
  computeWalkthroughPayCents,
  formatWhen,
  walkthroughLink,
} from "@/lib/proposal-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(req: Request) {
  try {
    return { principal: await requireAdmin(req), failure: null as NextResponse | null };
  } catch (e) {
    const err = e as AdminAuthError;
    return {
      principal: null,
      failure: NextResponse.json({ error: err.message }, { status: err.status || 401 }),
    };
  }
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const supabase = getAdminSupabase();
  const { data: sites } = await supabase
    .from("proposal_request_sites")
    .select("zip_code")
    .eq("proposal_request_id", params.id)
    .order("sort_order", { ascending: true });
  const zip = String((sites || [])[0]?.zip_code || "").replace(/\D/g, "").slice(0, 5);

  let siteLat: number | null = null;
  let siteLng: number | null = null;
  if (zip.length === 5) {
    const { data: geoRows } = await supabase
      .from("geocode_cache")
      .select("lat,lng")
      .eq("zip", zip)
      .limit(1);
    const geo = geoRows?.[0];
    if (geo) {
      siteLat = Number((geo as { lat: number }).lat);
      siteLng = Number((geo as { lng: number }).lng);
    }
  }

  const { data: cleaners, error } = await supabase
    .from("cleaners")
    .select(
      "id, first_name, last_name, email, phone, novara_score, overall_score, home_zip, home_lat, home_lng, max_travel_miles, status, approved, walkthrough_eligible, preferred_work_days",
    )
    .eq("walkthrough_eligible", true)
    .eq("status", "active")
    .order("novara_score", { ascending: false })
    .limit(80);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const weekday = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" }).toLowerCase();

  const ranked = (cleaners || []).map((c: Record<string, unknown>) => {
    const novara = Number(c.novara_score);
    let distance: number | null = null;
    let available = true;
    let reason = "";
    if (siteLat != null && siteLng != null && c.home_lat != null && c.home_lng != null) {
      distance = haversineMiles(Number(c.home_lat), Number(c.home_lng), siteLat, siteLng);
      const max = Number(c.max_travel_miles) || 25;
      if (distance > max) {
        available = false;
        reason = "too_far";
      }
    }
    const days = Array.isArray(c.preferred_work_days) ? (c.preferred_work_days as string[]).map((d) => d.toLowerCase()) : [];
    const worksToday = days.length === 0 || days.some((d) => weekday.startsWith(d.slice(0, 3)));
    const score =
      (Number.isFinite(novara) ? novara : 50) * 0.55 +
      (distance == null ? 20 : Math.max(0, 30 - distance)) +
      (worksToday ? 10 : 0) +
      (c.approved ? 5 : 0);
    return {
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone,
      novara_score: Number.isFinite(novara) ? novara : null,
      home_zip: c.home_zip,
      distance_miles: distance != null ? Math.round(distance * 10) / 10 : null,
      match_score: Math.round(score),
      available,
      reason: reason || undefined,
    };
  });
  ranked.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return b.match_score - a.match_score;
  });

  return NextResponse.json({ ok: true, candidates: ranked, zip: zip || null });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure) return failure;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const cleanerId = String(body.cleanerId || "").trim();
  const scheduledAt = String(body.scheduledAt || "").trim();
  if (!cleanerId) return NextResponse.json({ error: "Pick a walkthrough-eligible contractor." }, { status: 400 });
  if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
    return NextResponse.json({ error: "A date and time for the visit is required." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const settings = await loadProposalSettings(supabase);

  const { data: request } = await supabase
    .from("proposal_requests")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!request) return NextResponse.json({ error: "Proposal request not found." }, { status: 404 });
  const reqRow = request as Record<string, any>;

  const { data: cleaner } = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, email, phone, walkthrough_eligible, status")
    .eq("id", cleanerId)
    .maybeSingle();
  if (!cleaner) return NextResponse.json({ error: "Contractor not found." }, { status: 404 });
  const c = cleaner as Record<string, any>;
  if (!c.walkthrough_eligible) {
    return NextResponse.json(
      { error: "That contractor is not flagged walkthrough-eligible. Flag them on the Cleaners tab first." },
      { status: 400 },
    );
  }
  if (String(c.status || "").toLowerCase() !== "active") {
    return NextResponse.json({ error: "Only active contractors can take walkthrough assignments." }, { status: 400 });
  }

  const { data: sites } = await supabase
    .from("proposal_request_sites")
    .select("*")
    .eq("proposal_request_id", params.id)
    .order("sort_order", { ascending: true });
  const targetSiteId = String(body.siteId || "").trim();
  const targets = (sites || []).filter((s: Record<string, any>) =>
    targetSiteId ? s.id === targetSiteId || s.walkthrough_id === targetSiteId : true,
  );
  if (!targets.length) {
    return NextResponse.json({ error: "No sites on this request to assign." }, { status: 400 });
  }

  const hours = body.hours != null ? Number(body.hours) : null;
  const payCents = body.payCents != null
    ? Math.max(0, Math.round(Number(body.payCents)))
    : computeWalkthroughPayCents(settings, hours);
  const agentName = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "Walkthrough agent";
  const when = formatWhen(scheduledAt);
  const ttl = tokenExpiryIso(settings.tokenTtlHours);
  const links: string[] = [];
  const addresses: string[] = [];

  for (const site of targets as Array<Record<string, any>>) {
    const wtId = site.walkthrough_id as string | null;
    if (!wtId) continue;
    const { data: existingWt } = await supabase
      .from("commercial_walkthroughs")
      .select("assignment_token")
      .eq("id", wtId)
      .maybeSingle();
    const token = tokenForWalkthrough((existingWt as { assignment_token?: string } | null)?.assignment_token);
    const address = [site.address, site.city, site.state, site.zip_code].filter(Boolean).join(", ") || site.nickname;
    addresses.push(address);

    const { error: wtErr } = await supabase.from("commercial_walkthroughs").update({
      status: "scheduled",
      scheduled_at: scheduledAt,
      scheduled_for: scheduledAt.slice(0, 10),
      conducted_by: agentName,
      conductor_user_id: null,
      conductor_email: c.email || null,
      conductor_phone: c.phone || null,
      assigned_cleaner_id: cleanerId,
      assignment_token: token,
      token_expires_at: ttl,
      walkthrough_pay_cents: payCents,
      walkthrough_pay_type: settings.walkthroughPayType,
      access_contact_name: reqRow.site_contact_name,
      access_contact_phone: reqRow.site_contact_phone,
      access_contact_email: reqRow.site_contact_email,
      client_access_confirmed: body.clientAccessConfirmed === true,
      reminder_sent_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", wtId);
    if (wtErr) return NextResponse.json({ error: wtErr.message }, { status: 400 });

    const { data: existingPay } = await supabase
      .from("walkthrough_payouts")
      .select("id")
      .eq("walkthrough_id", wtId)
      .eq("cleaner_id", cleanerId)
      .neq("status", "void")
      .maybeSingle();
    const payRow = {
      walkthrough_id: wtId,
      proposal_request_id: params.id,
      cleaner_id: cleanerId,
      amount_cents: payCents,
      pay_type: settings.walkthroughPayType,
      hours: Number.isFinite(Number(hours)) ? hours : null,
      status: "owed" as const,
      note: `Paid walkthrough — ${address}. Owed whether or not the proposal converts.`,
      created_by: principal?.userId ?? null,
    };
    if (existingPay?.id) {
      await supabase.from("walkthrough_payouts").update(payRow).eq("id", (existingPay as { id: string }).id);
    } else {
      await supabase.from("walkthrough_payouts").insert(payRow);
    }

    const link = walkthroughLink(token);
    links.push(link);

    const sms =
      `Novara: paid walkthrough ${when.label} at ${address}. ` +
      `Open the site findings form (auto-saves): ${link}`;
    await sendProposalSms(supabase, c.phone, sms);
  }

  await supabase.from("proposal_requests").update({
    status: "walkthrough_scheduled",
    assigned_cleaner_id: cleanerId,
    scheduled_at: scheduledAt,
    updated_at: new Date().toISOString(),
  }).eq("id", params.id);

  const addressLabel = addresses.filter(Boolean).join("; ") || "the property";
  const firstLink = links[0] || "";

  await sendProposalEmail(supabase, {
    to: String(c.email || ""),
    subject: settings.agentEmailSubject,
    body: settings.agentEmailBody + (links.length > 1 ? `\n\nAll site links:\n${links.join("\n")}` : ""),
    vars: {
      agentName,
      address: addressLabel,
      date: when.date,
      time: when.time,
      link: firstLink,
    },
  });

  const requesterMail = await sendProposalEmail(supabase, {
    to: String(reqRow.requester_email),
    subject: settings.scheduledEmailSubject,
    body: settings.scheduledEmailBody,
    vars: {
      name: String(reqRow.requester_name || ""),
      address: addressLabel,
      date: when.date,
      time: when.time,
      agentName,
    },
  });
  if (requesterMail.ok) {
    await supabase.from("proposal_requests").update({
      requester_scheduled_email_sent_at: new Date().toISOString(),
    }).eq("id", params.id);
  }

  await supabase.from("events").insert({
    event_type: "walkthrough.assigned",
    source: "admin-proposals",
    summary:
      `Walkthrough agent ${agentName} assigned for ${addressLabel} on ${when.label}. ` +
      `Paid assignment ($${(payCents / 100).toFixed(2)}) — owed whether or not the proposal converts. Token emailed and texted.`,
    data: {
      proposal_request_id: params.id,
      cleaner_id: cleanerId,
      scheduled_at: scheduledAt,
      pay_cents: payCents,
      site_count: targets.length,
    },
  });

  return NextResponse.json({
    ok: true,
    payCents,
    links,
    requesterEmailed: requesterMail.ok,
  });
}
