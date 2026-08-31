import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { AGREEMENT_BUCKET, ensureHostCustomer } from "@/lib/host-onboarding/operations";
import { sendPartnershipMessage } from "@/lib/partnership-comms/server";
import { resolveAppSecret, stripeCall } from "@/lib/stripe-rest";
import { computeCancelFee } from "./cancel-fee";
import type { PartnerIdentity } from "./identity";
import { buildRateSchedulePdf } from "./rate-schedule-pdf";
import { publicStatusLabel, publicTurnoverStatus, stripCrewContact } from "./sanitize";
import { describeCustomerPaymentMethod } from "./stripe-billing";

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

  const docs: Array<{ label: string; url: string | null; date: string; kind?: string }> = [];
  for (const a of agreements || []) {
    docs.push({
      label: `Host Partnership Agreement — signed ${String(a.signed_at).slice(0, 10)}`,
      url: await signedUrl(supabase, AGREEMENT_BUCKET, a.document_path),
      date: a.signed_at,
      kind: "agreement",
    });
  }
  docs.push({
    label: "Property & Rate Schedule (current, Company-set)",
    url: "/api/partner-portal/host?download=rate_schedule",
    date: new Date().toISOString(),
    kind: "rate_schedule",
  });

  const payment = await describeCustomerPaymentMethod(
    host?.stripe_customer_id,
    host?.default_payment_method_id,
  );

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
      cardOnFile: payment.onFile || !!host?.default_payment_method_id,
      paymentBrand: payment.brand,
      paymentLast4: payment.last4,
      canUpdatePayment: true as const,
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
    })
    .eq("id", tr.id);

  await supabase.from("events").insert({
    event_type: "partner.host.turnover_rescheduled",
    source: "partner-portal",
    summary: `Host rescheduled a turnover to ${input.requestedDate}.`,
    data: { host_id: tr.host_id, turnover_id: tr.id, requested_date: input.requestedDate },
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
    successUrl: string;
    cancelUrl: string;
  },
) {
  const supabase = getAdminSupabase();
  const { data: property } = await supabase.from("properties").select("*").eq("id", input.propertyId).maybeSingle();
  if (!property || !ownsHost(identity, property.host_id)) return { ok: false as const, error: "Property not found." };
  if (property.turnover_price == null || Number(property.turnover_price) <= 0) {
    return { ok: false as const, error: "This property isn't priced yet. Our team sets the per-turnover rate." };
  }
  if (!input.requestedDate) return { ok: false as const, error: "Checkout date is required." };

  const { data: hostRow } = await supabase
    .from("hosts")
    .select("id, email, name, stripe_customer_id, default_payment_method_id, preferred_payment_option, pay_after_enabled")
    .eq("id", property.host_id)
    .maybeSingle();

  const option = ["full", "split", "pay_after"].includes(String(input.paymentOption))
    ? String(input.paymentOption)
    : hostRow?.preferred_payment_option || identity.hosts[0]?.paymentOption || "full";
  if (option === "pay_after" && !hostRow?.pay_after_enabled && !identity.hosts[0]?.payAfterEnabled) {
    return { ok: false as const, error: "Pay After isn't available for this account. Choose Pay in Full or Split Payment." };
  }

  const priceCents = Math.round(Number(property.turnover_price) * 100);
  const depositCents = option === "split" ? Math.floor(priceCents / 2) : option === "pay_after" ? 0 : priceCents;
  const balanceCents = priceCents - depositCents;
  const payment = await describeCustomerPaymentMethod(
    hostRow?.stripe_customer_id,
    hostRow?.default_payment_method_id,
  );

  if (option === "pay_after" && !payment.onFile) {
    return {
      ok: false as const,
      needsSetup: true as const,
      error: "Pay After needs a card on file. Save a payment method first, then request the turnover.",
    };
  }

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
      deposit_cents: depositCents,
      balance_cents: balanceCents,
      card_on_file: payment.onFile,
    })
    .select("id, status")
    .single();
  if (error || !tr) return { ok: false as const, error: error?.message || "Could not request that turnover." };

  await supabase.from("events").insert({
    event_type: "partner.host.turnover_requested",
    source: "partner-portal",
    summary: `Host requested a turnover on ${input.requestedDate}.`,
    data: { host_id: property.host_id, property_id: property.id, turnover_id: tr.id, payment_option: option },
  });

  if (option === "pay_after") {
    await invokePartnerTurnover({
      action: "turnover.finalizeByInvoice",
      turnoverId: tr.id,
      paymentIntentId: null,
    });
    return { ok: true as const, turnoverId: tr.id, status: "paid", scheduled: true as const };
  }

  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return { ok: false as const, error: "Payment is temporarily unavailable. Your request is saved as awaiting payment." };
  }

  let customerId = (hostRow?.stripe_customer_id as string) || null;
  try {
    customerId = await ensureHostCustomer(stripeKey, {
      hostId: property.host_id,
      email: String(hostRow?.email || identity.email || ""),
      name: String(hostRow?.name || identity.displayName || ""),
      existingId: customerId,
    });
    await supabase.from("hosts").update({ stripe_customer_id: customerId }).eq("id", property.host_id);
  } catch (err) {
    return { ok: false as const, error: `Could not start checkout: ${(err as Error).message}` };
  }

  if (payment.onFile && payment.id) {
    try {
      const pi = await stripeCall(stripeKey, "POST", "payment_intents", {
        amount: String(depositCents),
        currency: "usd",
        customer: customerId,
        payment_method: payment.id,
        off_session: "true",
        confirm: "true",
        "metadata[kind]": "turnover",
        "metadata[turnover_id]": tr.id,
        "metadata[host_id]": property.host_id,
        "metadata[payment_option]": option,
      });
      if (pi.status === "succeeded") {
        if (option === "split") {
          await supabase.from("turnover_requests").update({ deposit_payment_intent_id: pi.id }).eq("id", tr.id);
        }
        await invokePartnerTurnover({
          action: "turnover.finalizeByInvoice",
          turnoverId: tr.id,
          paymentIntentId: pi.id,
        });
        return { ok: true as const, turnoverId: tr.id, status: "paid", scheduled: true as const };
      }
    } catch {
      /* SCA / decline — fall through to Checkout */
    }
  }

  const label =
    option === "split"
      ? `Turnover deposit (50%) - ${property.nickname || property.address || "Property"}`
      : `Turnover - ${property.nickname || property.address || "Property"}`;
  try {
    const session = await stripeCall(stripeKey, "POST", "checkout/sessions", {
      customer: customerId,
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][product_data][name]": label,
      "line_items[0][price_data][unit_amount]": String(depositCents),
      "line_items[0][quantity]": "1",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "payment_intent_data[setup_future_usage]": "off_session",
      "metadata[kind]": "turnover",
      "metadata[turnover_id]": tr.id,
      "metadata[host_id]": property.host_id,
      "metadata[payment_option]": option,
    });
    await supabase
      .from("turnover_requests")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", tr.id);
    return {
      ok: true as const,
      turnoverId: tr.id,
      status: "pending_payment",
      checkoutUrl: String(session.url || ""),
    };
  } catch (err) {
    return { ok: false as const, error: `Could not open checkout: ${(err as Error).message}` };
  }
}

export async function finalizeTurnoverCheckout(identity: PartnerIdentity, sessionId: string) {
  if (!sessionId) return { ok: false as const, error: "Missing checkout session." };
  const supabase = getAdminSupabase();
  const { data: tr } = await supabase
    .from("turnover_requests")
    .select("id, host_id, stripe_checkout_session_id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (!tr || !ownsHost(identity, tr.host_id)) return { ok: false as const, error: "Turnover not found." };
  const result = await invokePartnerTurnover({ action: "turnover.finalize", sessionId });
  return { ok: true as const, ...result };
}

export async function hostRateSchedulePdf(identity: PartnerIdentity): Promise<Uint8Array> {
  const ids = hostIds(identity);
  const supabase = getAdminSupabase();
  const hostId = ids[0];
  const [{ data: host }, { data: properties }] = await Promise.all([
    hostId
      ? supabase.from("hosts").select("name").eq("id", hostId).maybeSingle()
      : Promise.resolve({ data: null }),
    hostId
      ? supabase
          .from("properties")
          .select("nickname, address, bedrooms, bathrooms, turnover_price")
          .eq("host_id", hostId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  return buildRateSchedulePdf({
    hostName: String(host?.name || identity.displayName || identity.email),
    properties: (properties || []).map((p: Record<string, unknown>) => ({
      nickname: (p.nickname as string) || null,
      address: (p.address as string) || null,
      bedrooms: p.bedrooms != null ? Number(p.bedrooms) : null,
      bathrooms: p.bathrooms != null ? Number(p.bathrooms) : null,
      turnoverPrice: p.turnover_price != null ? Number(p.turnover_price) : null,
    })),
  });
}

async function invokePartnerTurnover(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: "Not configured." };
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/functions/v1/partner-turnover`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
  await notifyHostAdmin({
    subject: `Additional property requested — ${identity.displayName || identity.email}`,
    html: [
      `<p><strong>${identity.displayName || identity.email}</strong> requested an additional property from the partner portal.</p>`,
      `<p>This has <strong>not</strong> been priced or added — it needs Company pricing under Section 5.</p>`,
      `<p><strong>${String(input.nickname || "Property").replace(/</g, "&lt;")}</strong><br/>${address.replace(/</g, "&lt;")}</p>`,
    ].join(""),
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

async function notifyHostAdmin(input: { subject: string; html: string }): Promise<void> {
  const supabase = getAdminSupabase();
  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "host_onboarding_settings")
    .maybeSingle();
  const notify =
    (setting?.value as { notify_email?: string } | null)?.notify_email ||
    process.env.HOST_ONBOARDING_NOTIFY_EMAIL ||
    null;
  if (!notify) return;
  await sendPartnershipMessage(supabase, {
    templateKey: "admin_internal_notice",
    trigger: "partner.host.additional_property",
    role: "admin",
    email: notify,
    subject: input.subject,
    html: input.html,
    vars: { subject_line: input.subject, body_html: input.html },
  }).catch(() => null);
}
