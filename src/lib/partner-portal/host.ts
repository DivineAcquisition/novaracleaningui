import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { AGREEMENT_BUCKET } from "@/lib/host-onboarding/operations";
import { computeCancelFee } from "./cancel-fee";
import type { PartnerIdentity } from "./identity";
import { publicStatusLabel, publicTurnoverStatus, stripCrewContact } from "./sanitize";

type Admin = any;

function hostIds(identity: PartnerIdentity): string[] {
  return identity.hosts.map((h) => h.id);
}

function ownsHost(identity: PartnerIdentity, hostId: string): boolean {
  return hostIds(identity).includes(hostId);
}

async function signedUrl(supabase: Admin, bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

export async function hostOverview(identity: PartnerIdentity) {
  const ids = hostIds(identity);
  if (!ids.length) return { ok: false as const, error: "No host relationship on this account." };
  const supabase = getAdminSupabase();
  const hostId = ids[0];

  const [{ data: host }, { data: properties }, { data: turnovers }, { data: agreements }] = await Promise.all([
    supabase
      .from("hosts")
      .select("id, name, email, status, preferred_payment_option, default_payment_method_id, pay_after_enabled, stripe_customer_id")
      .eq("id", hostId)
      .maybeSingle(),
    supabase
      .from("properties")
      .select("id, nickname, address, bedrooms, bathrooms, sqft, laundry_included, restock_included, turnover_price, special_notes")
      .eq("host_id", hostId)
      .order("created_at", { ascending: false }),
    supabase
      .from("turnover_requests")
      .select(
        "id, property_id, requested_date, window_start, window_end, price, status, payment_option, paid_at, completed_at, created_at, before_photos, after_photos, stripe_invoice_url, stripe_invoice_id, invoiced_at, cancel_fee_cents, cancel_fee_tier, host_rating, host_review",
      )
      .eq("host_id", hostId)
      .order("requested_date", { ascending: false })
      .limit(80),
    supabase
      .from("host_partnership_agreements")
      .select("id, signed_at, signer_name, document_path")
      .eq("host_id", hostId)
      .order("signed_at", { ascending: false })
      .limit(3),
  ]);

  const docs: Array<{ label: string; url: string | null; date: string }> = [];
  for (const a of agreements || []) {
    docs.push({
      label: `Host Partnership Agreement — signed ${String(a.signed_at).slice(0, 10)}`,
      url: await signedUrl(supabase, AGREEMENT_BUCKET, a.document_path),
      date: a.signed_at,
    });
    docs.push({
      label: `Property & Rate Schedule — ${String(a.signed_at).slice(0, 10)}`,
      url: await signedUrl(supabase, AGREEMENT_BUCKET, a.document_path),
      date: a.signed_at,
    });
  }

  const safeTurnovers = (turnovers || []).map((t: Record<string, unknown>) => {
    const priceCents = Math.round(Number(t.price || 0) * 100);
    const fee =
      t.status === "cancelled"
        ? null
        : computeCancelFee({
            requestedDate: String(t.requested_date),
            windowStart: (t.window_start as string) || null,
            priceCents,
          });
    return {
      id: t.id,
      propertyId: t.property_id,
      requestedDate: t.requested_date,
      windowStart: t.window_start,
      windowEnd: t.window_end,
      price: Number(t.price),
      status: publicTurnoverStatus(String(t.status)),
      statusLabel: publicStatusLabel(String(t.status)),
      paymentOption: t.payment_option,
      paidAt: t.paid_at,
      completedAt: t.completed_at,
      createdAt: t.created_at,
      beforePhotos: t.before_photos || [],
      afterPhotos: t.after_photos || [],
      invoiceUrl: t.stripe_invoice_url || null,
      invoicedAt: t.invoiced_at || null,
      cancelFee: fee,
      recordedCancelFeeCents: t.cancel_fee_cents ?? null,
      recordedCancelTier: t.cancel_fee_tier ?? null,
      hostRating: t.host_rating ?? null,
    };
  });

  return stripCrewContact({
    ok: true as const,
    host: {
      id: host?.id || hostId,
      name: host?.name || identity.displayName,
      email: host?.email || identity.email,
      status: host?.status || "active",
      paymentOption: host?.preferred_payment_option || identity.hosts[0]?.paymentOption || null,
      cardOnFile: !!host?.default_payment_method_id,
      payAfterEnabled: !!host?.pay_after_enabled,
    },
    properties: (properties || []).map((p: Record<string, unknown>) => ({
      id: p.id,
      nickname: p.nickname,
      address: p.address,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      sqft: p.sqft,
      laundryIncluded: p.laundry_included,
      restockIncluded: p.restock_included,
      turnoverPrice: p.turnover_price != null ? Number(p.turnover_price) : null,
      rateEditable: false as const,
      notes: p.special_notes || null,
    })),
    turnovers: safeTurnovers,
    documents: docs,
  });
}

export async function previewCancelFee(identity: PartnerIdentity, turnoverId: string) {
  const supabase = getAdminSupabase();
  const { data: tr } = await supabase
    .from("turnover_requests")
    .select("id, host_id, requested_date, window_start, price, status")
    .eq("id", turnoverId)
    .maybeSingle();
  if (!tr || !ownsHost(identity, tr.host_id)) return { ok: false as const, error: "Turnover not found." };
  return {
    ok: true as const,
    fee: computeCancelFee({
      requestedDate: tr.requested_date,
      windowStart: tr.window_start,
      priceCents: Math.round(Number(tr.price || 0) * 100),
    }),
    status: tr.status,
  };
}

export async function cancelTurnover(identity: PartnerIdentity, turnoverId: string) {
  const supabase = getAdminSupabase();
  const { data: tr } = await supabase
    .from("turnover_requests")
    .select("*")
    .eq("id", turnoverId)
    .maybeSingle();
  if (!tr || !ownsHost(identity, tr.host_id)) return { ok: false as const, error: "Turnover not found." };
  if (["completed", "cancelled"].includes(tr.status)) return { ok: false as const, error: "Already closed." };

  const fee = computeCancelFee({
    requestedDate: tr.requested_date,
    windowStart: tr.window_start,
    priceCents: Math.round(Number(tr.price || 0) * 100),
  });
  await supabase
    .from("turnover_requests")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_fee_cents: fee.feeCents,
      cancel_fee_tier: fee.tier,
      cancel_hours_out: fee.hoursOut,
    })
    .eq("id", tr.id);

  await supabase.from("events").insert({
    event_type: "partner.host.turnover_cancelled",
    source: "partner-portal",
    summary: `Host cancelled a turnover (${fee.label}). Fee ${fee.feeCents} cents.`,
    data: { host_id: tr.host_id, turnover_id: tr.id, fee },
  });
  return { ok: true as const, fee };
}

export async function rescheduleTurnover(
  identity: PartnerIdentity,
  input: { turnoverId: string; requestedDate: string; windowStart?: string; windowEnd?: string },
) {
  const supabase = getAdminSupabase();
  const { data: tr } = await supabase
    .from("turnover_requests")
    .select("*")
    .eq("id", input.turnoverId)
    .maybeSingle();
  if (!tr || !ownsHost(identity, tr.host_id)) return { ok: false as const, error: "Turnover not found." };
  if (["completed", "cancelled"].includes(tr.status)) return { ok: false as const, error: "This turnover is closed." };
  if (!input.requestedDate) return { ok: false as const, error: "Pick a new date." };

  const fee = computeCancelFee({
    requestedDate: tr.requested_date,
    windowStart: tr.window_start,
    priceCents: Math.round(Number(tr.price || 0) * 100),
  });
  await supabase
    .from("turnover_requests")
    .update({
      requested_date: input.requestedDate,
      window_start: input.windowStart || tr.window_start,
      window_end: input.windowEnd || tr.window_end,
      reschedule_count: (Number(tr.reschedule_count) || 0) + 1,
      last_rescheduled_at: new Date().toISOString(),
      cancel_fee_cents: fee.feeCents,
      cancel_fee_tier: fee.tier,
      cancel_hours_out: fee.hoursOut,
    })
    .eq("id", tr.id);

  await supabase.from("events").insert({
    event_type: "partner.host.turnover_rescheduled",
    source: "partner-portal",
    summary: `Host rescheduled a turnover to ${input.requestedDate} (${fee.label}).`,
    data: { host_id: tr.host_id, turnover_id: tr.id, fee, requested_date: input.requestedDate },
  });
  return { ok: true as const, fee };
}

export async function requestTurnover(
  identity: PartnerIdentity,
  input: {
    propertyId: string;
    requestedDate: string;
    windowStart?: string;
    windowEnd?: string;
    notes?: string;
    paymentOption?: string;
  },
) {
  const supabase = getAdminSupabase();
  const { data: property } = await supabase.from("properties").select("*").eq("id", input.propertyId).maybeSingle();
  if (!property || !ownsHost(identity, property.host_id)) return { ok: false as const, error: "Property not found." };
  if (property.turnover_price == null || Number(property.turnover_price) <= 0) {
    return { ok: false as const, error: "This property isn't priced yet. Our team sets the per-turnover rate." };
  }
  if (!input.requestedDate) return { ok: false as const, error: "Checkout date is required." };

  const option = ["full", "split", "pay_after"].includes(String(input.paymentOption))
    ? String(input.paymentOption)
    : identity.hosts[0]?.paymentOption || "full";
  const { data: tr, error } = await supabase
    .from("turnover_requests")
    .insert({
      property_id: property.id,
      host_id: property.host_id,
      requested_date: input.requestedDate,
      window_start: input.windowStart || null,
      window_end: input.windowEnd || null,
      price: Number(property.turnover_price),
      status: "pending_payment",
      notes: (input.notes || "").trim() || null,
      payment_option: option,
    })
    .select("id, status")
    .single();
  if (error || !tr) return { ok: false as const, error: error?.message || "Could not request that turnover." };

  await supabase.from("events").insert({
    event_type: "partner.host.turnover_requested",
    source: "partner-portal",
    summary: `Host requested a turnover on ${input.requestedDate}.`,
    data: { host_id: property.host_id, property_id: property.id, turnover_id: tr.id },
  });
  return { ok: true as const, turnoverId: tr.id, status: tr.status };
}

export async function requestAdditionalProperty(
  identity: PartnerIdentity,
  input: { nickname?: string; address: string; bedrooms?: number; bathrooms?: number; notes?: string },
) {
  const hostId = hostIds(identity)[0];
  if (!hostId) return { ok: false as const, error: "No host relationship on this account." };
  const address = String(input.address || "").trim();
  if (address.length < 5) return { ok: false as const, error: "Add the address of the property you'd like us to price." };

  const supabase = getAdminSupabase();
  await supabase.from("partner_portal_requests").insert({
    identity_id: identity.id,
    relationship: "host",
    kind: "additional_property",
    host_id: hostId,
    payload: {
      nickname: input.nickname || null,
      address,
      bedrooms: input.bedrooms ?? null,
      bathrooms: input.bathrooms ?? null,
      notes: input.notes || null,
    },
    status: "pending",
  });
  await supabase.from("events").insert({
    event_type: "partner.host.additional_property",
    source: "partner-portal",
    summary: `${identity.displayName || identity.email} requested an additional property: ${address.slice(0, 160)}`,
    data: { host_id: hostId, address, priced: false },
  });
  return {
    ok: true as const,
    message: "Thanks — that's with our team to price. It won't appear on your schedule until we set a rate.",
  };
}

export async function reportHostIssue(
  identity: PartnerIdentity,
  input: { title: string; description: string; turnoverId?: string; propertyId?: string },
) {
  const hostId = hostIds(identity)[0];
  if (!hostId) return { ok: false as const, error: "No host relationship on this account." };
  const title = String(input.title || "").trim().slice(0, 200);
  const description = String(input.description || "").trim().slice(0, 4000);
  if (!title) return { ok: false as const, error: "Add a short title for the issue." };

  const supabase = getAdminSupabase();
  let turnoverRequestId: string | null = null;
  if (input.turnoverId) {
    const { data: tr } = await supabase
      .from("turnover_requests")
      .select("id, host_id")
      .eq("id", input.turnoverId)
      .maybeSingle();
    if (tr && ownsHost(identity, tr.host_id)) turnoverRequestId = tr.id;
  }

  const { data: issue, error } = await supabase
    .from("qc_issues")
    .insert({
      booking_id: null,
      turnover_request_id: turnoverRequestId,
      partner_identity_id: identity.id,
      issue_type: "complaint",
      severity: "medium",
      status: "open",
      title,
      description,
      reported_via: "partner_portal",
      reported_by_name: identity.displayName || identity.email,
      client_name: identity.displayName || identity.email,
      client_email: identity.email,
      client_type: "str",
    })
    .select("id, issue_number")
    .single();
  if (error) return { ok: false as const, error: error.message };

  await supabase.from("events").insert({
    event_type: "partner.host.issue_reported",
    source: "partner-portal",
    summary: `Host reported an issue: ${title}`,
    data: { host_id: hostId, qc_issue_id: issue.id, turnover_request_id: turnoverRequestId },
  });
  return { ok: true as const, issueId: issue.id, issueNumber: issue.issue_number };
}
