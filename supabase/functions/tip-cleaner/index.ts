// tip-cleaner
//
// Customer tips — 100% pass-through to the cleaner(s), walled off from
// scores, tier progression, and job-value math.
//
//   { action:"checkout", bookingId, amountCents, directedCleanerId? }
//     Creates a Stripe Checkout session for the tip. Metadata carries the
//     booking + optional customer-directed cleaner ("this is for Maria").
//     Returns the payment URL.
//
//   { action:"confirm", sessionId }
//     Called from the success page. Verifies the session PAID with Stripe,
//     then (idempotently, keyed on session id):
//       • splits the tip equally across the job's ACTUAL crew record
//         (job_assignments for the booking's job; fallback booking.cleaner_id)
//         unless customer-directed — then 100% to that cleaner
//       • writes cleaner_tips rows (each share, full pass-through)
//       • bumps bookings.tip_cents by the total
//       • notifies each cleaner by SMS + email (best-effort)
//     Scores, tiers, payroll job-pay math are never touched.
//
//   { action:"crew", bookingId }
//     Public helper for the tip UI: the crew names on the job (first names
//     only) so the customer can direct a tip.
//
//   { action:"resolve_token", token }
//     Public: resolve a job_feedback token into booking + crew for the
//     tip-only page (/leave-tip/<token>).
//
//   { action:"invite", bookingId }
//     Mint (or reuse) a tip link + SMS/email the customer. Used by ops.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}
const log = (m: string, d?: unknown) =>
  console.log(`[tip-cleaner] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

const TIP_SITE_BASE = "https://try.novaracleaning.com";

// deno-lint-ignore no-explicit-any
type SB = any;

type CrewMember = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
};

async function resolveSecret(supabase: SB, key: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    return ((data?.value as string) || Deno.env.get(key) || "").trim();
  } catch {
    return (Deno.env.get(key) || "").trim();
  }
}

async function stripeCall(key: string, method: "GET" | "POST", path: string, params?: Record<string, string>): Promise<Record<string, any>> {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${key}` } };
  if (params && method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else if (params) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(params).toString();
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data;
}

function randomToken(bytes = 20): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function tipInviteUrl(token: string): string {
  return `${TIP_SITE_BASE}/leave-tip/${token}`;
}

function serviceLabel(t?: string | null): string {
  if (!t) return "cleaning";
  const map: Record<string, string> = {
    standard: "Standard Clean",
    standard_clean: "Standard Clean",
    deep: "Deep Clean",
    deep_clean: "Deep Clean",
    move_in_out: "Move-In/Out Clean",
    move_in: "Move-In Clean",
    move_out: "Move-Out Clean",
    recurring: "Recurring Clean",
    airbnb: "Turnover Clean",
    str_turnover: "Turnover Clean",
    turnover: "Turnover Clean",
  };
  const key = String(t).toLowerCase().trim();
  if (map[key]) return map[key];
  const titled = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return /(clean|turnover)/i.test(titled) ? titled : `${titled} Clean`;
}

function shortDate(d?: string | null): string {
  if (!d) return "";
  try {
    return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(d);
  }
}

function crewPhrase(names: string[]): string {
  const clean = (names || []).map((n) => (n || "").trim()).filter(Boolean);
  if (clean.length === 0) return "your cleaner";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function displayName(c: { first_name: string | null; last_name: string | null }): string {
  return `${c.first_name || ""} ${(c.last_name || "").slice(0, 1)}`.trim();
}

/** The job's actual crew: confirmed/accepted/completed assignments, else the booking's cleaner. */
async function crewForBooking(supabase: SB, booking: { job_id: string | null; cleaner_id: string | null }): Promise<CrewMember[]> {
  const ids = new Set<string>();
  if (booking.job_id) {
    const { data: assigns } = await supabase
      .from("job_assignments")
      .select("cleaner_id, status")
      .eq("job_id", booking.job_id);
    for (const a of assigns || []) {
      const s = String(a.status || "").toLowerCase();
      if (a.cleaner_id && ["confirmed", "accepted", "completed", "in progress"].includes(s)) ids.add(a.cleaner_id);
    }
  }
  if (ids.size === 0 && booking.cleaner_id) ids.add(booking.cleaner_id);
  if (ids.size === 0) return [];
  const { data: cleaners } = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, phone, email")
    .in("id", [...ids]);
  return cleaners || [];
}

async function ensureTipToken(supabase: SB, bookingId: string): Promise<{ token: string; id: string }> {
  const { data: existing } = await supabase
    .from("job_feedback")
    .select("id, token, expires_at")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (existing?.token) {
    // Extend expiry if it's already past so the tip link stays usable.
    const expired = existing.expires_at && new Date(existing.expires_at).getTime() < Date.now();
    if (expired) {
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from("job_feedback").update({ expires_at: expiresAt, updated_at: new Date().toISOString() }).eq("id", existing.id);
    }
    return { token: existing.token, id: existing.id };
  }

  const token = randomToken(20);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: inserted, error } = await supabase
    .from("job_feedback")
    .insert({
      booking_id: bookingId,
      token,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id, token")
    .single();
  if (error) {
    const { data: again } = await supabase
      .from("job_feedback")
      .select("id, token")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (again?.token) return { token: again.token, id: again.id };
    throw error;
  }
  return { token: inserted.token, id: inserted.id };
}

async function sendCustomerTipInvite(
  supabase: SB,
  opts: {
    firstName: string | null;
    email: string | null;
    phone: string | null;
    bookingRef: string | null;
    serviceType: string | null;
    serviceDate: string | null;
    city: string | null;
    crewNames: string[];
    url: string;
  },
): Promise<{ smsSent: boolean; emailSent: boolean }> {
  const name = opts.firstName?.trim() || "there";
  const crew = crewPhrase(opts.crewNames);
  const when = shortDate(opts.serviceDate);
  const svc = serviceLabel(opts.serviceType);
  const place = opts.city ? ` in ${opts.city}` : "";

  let smsSent = false;
  if (opts.phone) {
    const message =
      `Hi ${name}! Thank you for choosing Novara Cleaning. ` +
      `If you'd like to tip ${crew} for your ${svc}${when ? ` on ${when}` : ""}${place}, ` +
      `100% goes to them: ${opts.url} Reply STOP to opt out.`;
    try {
      const { error } = await supabase.functions.invoke("send-ghl-sms", {
        body: { phone: opts.phone, message },
      });
      smsSent = !error;
    } catch (e) {
      log("invite SMS failed", String(e));
    }
  }

  let emailSent = false;
  if (opts.email) {
    try {
      const resendKey = await resolveSecret(supabase, "RESEND_API_KEY");
      if (resendKey) {
        const rows: Array<[string, string]> = [];
        if (opts.bookingRef) rows.push(["Booking", opts.bookingRef]);
        rows.push(["Service", svc]);
        if (when) rows.push(["Date", when]);
        if (opts.city) rows.push(["Location", opts.city]);
        rows.push([opts.crewNames.length > 1 ? "Cleaners" : "Cleaner", crew]);
        const rowsHtml = rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:5px 16px 5px 0;color:#6b7280;font-size:13px;white-space:nowrap;">${k}</td>` +
              `<td style="padding:5px 0;color:#111827;font-size:13px;font-weight:600;">${v}</td></tr>`,
          )
          .join("");
        const html = `
          <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
            <p>Hi ${name},</p>
            <p>Thank you again for trusting Novara Cleaning. If you'd like to leave a tip for ${crew}, 100% goes straight to them — Novara takes nothing.</p>
            <table style="border-collapse:collapse;margin:18px 0;background:#f9fafb;border-radius:10px;padding:8px;">
              <tbody>${rowsHtml}</tbody>
            </table>
            <p style="margin:24px 0;">
              <a href="${opts.url}"
                 style="background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;">
                Tip your ${opts.crewNames.length > 1 ? "crew" : "cleaner"}
              </a>
            </p>
            <p style="font-size:13px;color:#6b7280;">This link is personal to your job and expires after a short window.</p>
          </div>`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Novara Cleaning <hello@novaracleaning.com>",
            to: [opts.email],
            subject: `Tip ${crew} for your Novara clean`,
            html,
          }),
        });
        emailSent = res.ok;
        if (!res.ok) log("invite email failed", await res.text().catch(() => ""));
      }
    } catch (e) {
      log("invite email error", String(e));
    }
  }

  return { smsSent, emailSent };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "crew") {
      const bookingId = String(body?.bookingId || "");
      if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);
      const { data: booking } = await supabase
        .from("bookings").select("id, job_id, cleaner_id, status").eq("id", bookingId).maybeSingle();
      if (!booking) return json({ ok: false, error: "Booking not found" }, 404);
      const crew = await crewForBooking(supabase, booking);
      return json({
        ok: true,
        crew: crew.map((c) => ({ id: c.id, name: displayName(c) })),
      });
    }

    if (action === "resolve_token") {
      const token = String(body?.token || "").trim();
      if (!token) return json({ ok: false, error: "token required" }, 400);
      const { data: fb } = await supabase
        .from("job_feedback")
        .select("id, booking_id, token, expires_at")
        .eq("token", token)
        .maybeSingle();
      if (!fb) return json({ ok: false, error: "invalid" }, 404);
      if (fb.expires_at && new Date(fb.expires_at).getTime() < Date.now()) {
        return json({ ok: false, error: "expired" }, 410);
      }
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, booking_number, first_name, job_id, cleaner_id, service_type, service_date, city, status")
        .eq("id", fb.booking_id)
        .maybeSingle();
      if (!booking) return json({ ok: false, error: "invalid" }, 404);
      const crew = await crewForBooking(supabase, booking);
      const ref = booking.booking_number
        ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
        : null;
      return json({
        ok: true,
        bookingId: booking.id,
        firstName: booking.first_name,
        bookingRef: ref,
        serviceLabel: serviceLabel(booking.service_type),
        serviceDate: shortDate(booking.service_date),
        city: booking.city,
        crew: crew.map((c) => ({ id: c.id, name: displayName(c) })),
      });
    }

    if (action === "invite") {
      const bookingId = String(body?.bookingId || "");
      if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, booking_number, first_name, email, phone, job_id, cleaner_id, service_type, service_date, city")
        .eq("id", bookingId)
        .maybeSingle();
      if (!booking) return json({ ok: false, error: "Booking not found" }, 404);
      const crew = await crewForBooking(supabase, booking);
      if (crew.length === 0) return json({ ok: false, error: "No cleaner on record for this job yet." }, 400);

      const { token, id: feedbackId } = await ensureTipToken(supabase, bookingId);
      const url = tipInviteUrl(token);
      const ref = booking.booking_number
        ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
        : null;
      const { smsSent, emailSent } = await sendCustomerTipInvite(supabase, {
        firstName: booking.first_name,
        email: booking.email,
        phone: booking.phone,
        bookingRef: ref,
        serviceType: booking.service_type,
        serviceDate: booking.service_date,
        city: booking.city,
        crewNames: crew.map((c) => (c.first_name || "").trim()).filter(Boolean),
        url,
      });

      if (smsSent || emailSent) {
        await supabase
          .from("job_feedback")
          .update({ sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", feedbackId)
          .is("sent_at", null);
      }

      await supabase.from("events").insert({
        event_type: "cleaner.tip_invite_sent",
        booking_id: bookingId,
        source: "tip-cleaner",
        summary: `Tip invite sent to ${booking.first_name || "customer"} for ${ref || bookingId.slice(0, 8)} (sms=${smsSent}, email=${emailSent}).`,
        data: { url, smsSent, emailSent, crew: crew.map((c) => c.id) },
      }).then(() => undefined, () => undefined);

      return json({ ok: true, url, token, smsSent, emailSent });
    }

    if (action === "checkout") {
      const bookingId = String(body?.bookingId || "");
      const amountCents = Math.round(Number(body?.amountCents) || 0);
      const directedCleanerId = body?.directedCleanerId ? String(body.directedCleanerId) : "";
      if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);
      if (amountCents < 100 || amountCents > 50000) return json({ ok: false, error: "Tip must be between $1 and $500." }, 400);

      const { data: booking } = await supabase
        .from("bookings")
        .select("id, booking_number, job_id, cleaner_id, first_name, email, status")
        .eq("id", bookingId)
        .maybeSingle();
      if (!booking) return json({ ok: false, error: "Booking not found" }, 404);
      const crew = await crewForBooking(supabase, booking);
      if (crew.length === 0) return json({ ok: false, error: "No cleaner on record for this job yet." }, 400);
      if (directedCleanerId && !crew.some((c) => c.id === directedCleanerId)) {
        return json({ ok: false, error: "That cleaner wasn't on this job." }, 400);
      }

      const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
      if (!stripeKey) return json({ ok: false, error: "Payments not configured." }, 500);

      const origin = req.headers.get("origin") || "https://app.novaracleaning.com";
      const ref = booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : bookingId.slice(0, 8);
      // Callers (e.g. the tokenized feedback page) may supply their own
      // return URLs so the customer lands back where they started. The
      // success URL must carry the Stripe session placeholder so the
      // confirm step can verify payment.
      const successUrl = typeof body?.successUrl === "string" && body.successUrl.includes("{CHECKOUT_SESSION_ID}")
        ? String(body.successUrl)
        : `${origin}/tip/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = typeof body?.cancelUrl === "string" && body.cancelUrl.startsWith("http")
        ? String(body.cancelUrl)
        : `${origin}/account`;
      const session = await stripeCall(stripeKey, "POST", "checkout/sessions", {
        mode: "payment",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(amountCents),
        "line_items[0][price_data][product_data][name]": `Tip for your cleaning crew — ${ref}`,
        "line_items[0][quantity]": "1",
        ...(booking.email ? { customer_email: booking.email } : {}),
        success_url: successUrl,
        cancel_url: cancelUrl,
        "metadata[kind]": "cleaner_tip",
        "metadata[booking_id]": bookingId,
        "metadata[directed_cleaner_id]": directedCleanerId,
        "payment_intent_data[description]": `Cleaner tip — ${ref} (100% pass-through)`,
      });
      return json({ ok: true, url: session.url, sessionId: session.id });
    }

    if (action === "confirm") {
      const sessionId = String(body?.sessionId || "");
      if (!sessionId) return json({ ok: false, error: "sessionId required" }, 400);

      // Idempotency: already recorded?
      const { data: existing } = await supabase
        .from("cleaner_tips").select("id").eq("stripe_session_id", sessionId).limit(1);
      if (existing && existing.length > 0) return json({ ok: true, already: true });

      const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
      const session = await stripeCall(stripeKey, "GET", `checkout/sessions/${encodeURIComponent(sessionId)}`);
      if (session?.metadata?.kind !== "cleaner_tip") return json({ ok: false, error: "Not a tip session." }, 400);
      if (session.payment_status !== "paid") return json({ ok: false, error: "Payment not completed yet." }, 400);

      const bookingId = String(session.metadata.booking_id || "");
      const directedCleanerId = String(session.metadata.directed_cleaner_id || "");
      const totalCents = Number(session.amount_total) || 0;
      const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;

      const { data: booking } = await supabase
        .from("bookings")
        .select("id, booking_number, job_id, cleaner_id, tip_cents, first_name")
        .eq("id", bookingId)
        .maybeSingle();
      if (!booking) return json({ ok: false, error: "Booking not found" }, 404);

      const crew = await crewForBooking(supabase, booking);
      const recipients = directedCleanerId
        ? crew.filter((c) => c.id === directedCleanerId)
        : crew;
      if (recipients.length === 0) return json({ ok: false, error: "No crew on record." }, 400);

      // Equal split; remainder cents go to the first cleaner so shares sum
      // exactly to the customer's tip (100% pass-through, company takes 0).
      const base = Math.floor(totalCents / recipients.length);
      const remainder = totalCents - base * recipients.length;
      const rows = recipients.map((c, i) => ({
        booking_id: bookingId,
        cleaner_id: c.id,
        amount_cents: base + (i === 0 ? remainder : 0),
        allocation: directedCleanerId ? "directed" : "split",
        crew_size: recipients.length,
        total_tip_cents: totalCents,
        stripe_session_id: sessionId,
        stripe_payment_intent_id: piId,
        status: "received",
      }));
      const { error: insErr } = await supabase.from("cleaner_tips").insert(rows);
      if (insErr) {
        // Unique index on (session, cleaner) makes double-confirms harmless.
        if (String(insErr.message).includes("duplicate")) return json({ ok: true, already: true });
        throw insErr;
      }

      await supabase.from("bookings").update({
        tip_cents: (Number(booking.tip_cents) || 0) + totalCents,
      }).eq("id", bookingId);

      const ref = booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : bookingId.slice(0, 8);
      await supabase.from("events").insert({
        event_type: "cleaner.tip_received",
        booking_id: bookingId,
        source: "tip-cleaner",
        summary: `💜 $${(totalCents / 100).toFixed(2)} tip on ${ref} — ${directedCleanerId ? `directed to ${recipients[0].first_name}` : `split ${recipients.length} way${recipients.length === 1 ? "" : "s"}`} (100% pass-through).`,
        data: { total_cents: totalCents, crew: recipients.map((c) => c.id), directed: Boolean(directedCleanerId) },
      }).then(() => undefined, () => undefined);

      // Tell the crew by SMS + email (best-effort).
      for (const [i, c] of recipients.entries()) {
        const share = rows[i].amount_cents;
        const shareStr = `$${(share / 100).toFixed(2)}`;
        const totalStr = `$${(totalCents / 100).toFixed(2)}`;
        const splitNote = recipients.length > 1 ? ` (split of a ${totalStr} crew tip)` : "";
        const smsBody =
          `Novara: You received a ${shareStr} tip from your ${ref} customer${splitNote}. ` +
          `100% goes to you — it will be included with your next payout. 💜`;

        if (c.phone) {
          await supabase.functions.invoke("send-ghl-sms", {
            body: { phone: c.phone, message: smsBody },
          }).catch(() => undefined);
        }

        if (c.email) {
          try {
            const resendKey = await resolveSecret(supabase, "RESEND_API_KEY");
            if (resendKey) {
              const first = c.first_name || "there";
              const customerName = booking.first_name || "your customer";
              const splitLine = recipients.length > 1
                ? `Your share of the ${totalStr} crew tip is below.`
                : "100% of it goes to you.";
              const html = `
                <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
                  <h2 style="margin:0 0 8px;font-size:20px">You received a tip 💜</h2>
                  <p style="margin:0 0 16px;color:#475569">Hi ${first},</p>
                  <p style="margin:0 0 16px;color:#475569">${customerName} left a tip on ${ref}. ${splitLine}</p>
                  <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:18px;text-align:center;margin:0 0 16px">
                    <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6d28d9">Your tip</div>
                    <div style="font-size:32px;font-weight:800;color:#5b21b6;margin-top:4px">${shareStr}</div>
                    <div style="font-size:12px;color:#7c3aed;margin-top:4px">100% pass-through — Novara takes nothing</div>
                  </div>
                  <p style="margin:0 0 8px;color:#475569;font-size:14px">It will be included with your next payout.</p>
                  <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Novara Cleaning</p>
                </div>`;
              await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  from: "Novara Cleaning <hello@novaracleaning.com>",
                  to: [c.email],
                  subject: `You received a ${shareStr} tip 💜`,
                  html,
                }),
              });
            }
          } catch {
            /* best-effort */
          }
        }
      }

      return json({ ok: true, totalCents, shares: rows.map((r) => ({ cleanerId: r.cleaner_id, amountCents: r.amount_cents })) });
    }

    return json({ ok: false, error: `Unknown action '${action}'` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
