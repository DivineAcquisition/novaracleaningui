import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { ensureJobChecklist } from "../_shared/job-checklist.ts";
import { documentBookingAddonsInQcSafe } from "../_shared/addon-qc.ts";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { sendSms, formatServiceDate, formatTimeSlot } from "../_shared/sms.ts";
import { SUPPORT_PHONE_DISPLAY } from "../_shared/booking-policy.ts";
import { invoicePaymentSettingsSaveCard } from "../_shared/stripe-invoice-save-card.ts";

// admin-modify-booking
//
// Admin/VA edits from the Bookings tab. Body.action selects the path:
//
//   update_service (default) — service type, home size, add-ons, bed/bath.
//     Customer is notified via SMS AND email. Pricing is authoritative from
//     the admin UI (same src/lib/pricing the customer sees), so this function
//     trusts the supplied totalEstimateCents and records it.
//
//   update_customer_info — name, email, phone, address on THIS booking.
//     Also mirrors the patch onto the linked customers + jobs rows when
//     present so the directory / dispatch board don't go stale. No customer
//     "service changed" blast — this is a records correction.
//
//   update_job_notes — access_notes + team_notes on THIS booking. Shown on
//     the assigned cleaner's dashboard (job details + checklist). Not sent
//     to the customer. Mirrors access_notes onto jobs.notes when a job row
//     exists so dispatch/calendar stay in sync.
//
//   reinstate_unpaid_deposit — reopen a booking auto-cancelled for an unpaid
//     deposit after the customer asked to keep the date. Resets the reminder
//     window, re-issues the invoice, and texts/emails the pay link.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SUPPORT_PHONE_DISPLAY = "(844) 735-2070";
const SERVICE_LABELS: Record<string, string> = {
  standard: "Standard Clean",
  deep: "Deep Clean",
  combo: "Deep + Standard Combo",
  moveInOut: "Move-In / Move-Out Clean",
};

// Add-on id → display label. Mirrors src/lib/pricing.ts ADD_ONS so the
// customer SMS/email reads human labels rather than raw ids.
const ADD_ON_LABELS: Record<string, string> = {
  fridge: "Inside Fridge",
  oven: "Inside Oven",
  windows: "Interior Windows",
  laundry: "Laundry — wash & fold",
  changeLinens: "Change bed linens",
  dishes: "Dishes & kitchen cleanup",
  baseboards: "Baseboards (hand-wiped)",
  blinds: "Blinds & shutters",
  cabinets: "Inside cabinets",
  walls: "Spot wall washing",
  ceilingFans: "Ceiling fans",
  microwave: "Inside microwave",
  dishwasher: "Inside dishwasher",
  garage: "Garage sweep-out",
  basement: "Basement clean",
  patio: "Patio / balcony",
  petHair: "Heavy pet-hair removal",
  closets: "Inside closets / tidy",
  trashHaul: "Trash haul",
  deepBathroomDetail: "Deep bathroom detail",
  cateringEvent: "Catering / event cleanup",
  firstCleanDeep: "First-clean deep clean",
  pestLight: "Pest — Light",
  moldMinor: "Mold — Minor (surface)",
};

function addOnLabel(id: string): string {
  return ADD_ON_LABELS[id] || String(id).replace(/_/g, " ");
}

// deno-lint-ignore no-explicit-any
async function sendSms(admin: any, toPhone: string | null | undefined, message: string) {
  const phone = (toPhone || "").toString().trim();
  if (!phone || !message.trim()) return false;
  try {
    const { data, error } = await admin.functions.invoke("send-ghl-sms", {
      body: { phone, message, type: "confirmation" },
    });
    if (!error && !(data && data.error)) return true;
  } catch (_) { /* fall through */ }
  try {
    const { error } = await admin.functions.invoke("send-sms-notification", {
      body: { toPhone: phone, message, type: "confirmation" },
    });
    return !error;
  } catch (_) {
    return false;
  }
}

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, req: Request): Promise<string> {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new Error("Admin authorization required");
  const token = auth.replace(/^Bearer\s+/i, "");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: u } = await userClient.auth.getUser(token);
  if (!u?.user?.id) throw new Error("Not signed in");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only");
  return u.user.id;
}

function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").toLowerCase().trim();
}

/** Digits only. Returns "" (not null) — bookings.phone is NOT NULL. */
function normalizePhone(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * Every customer-facing column on `bookings` and `jobs` is NOT NULL, so a
 * cleared field has to be written as "" rather than null or the whole save
 * fails with a 23502.
 */
function trimStr(raw: unknown): string {
  return String(raw ?? "").trim();
}

/**
 * Supabase client errors are plain objects, not Errors — `String(err)` on one
 * yields "[object Object]" and tells an operator nothing. Pull out the parts
 * Postgres actually filled in.
 */
function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [o.message, o.details, o.hint].filter(Boolean);
    if (parts.length > 0) return `${parts.join(" — ")}${o.code ? ` (${o.code})` : ""}`;
    try {
      return JSON.stringify(e);
    } catch {
      return "Unknown error";
    }
  }
  return String(e);
}

async function reissueDepositInvoice(
  // deno-lint-ignore no-explicit-any
  admin: any,
  booking: Record<string, unknown>,
): Promise<string | null> {
  const existingUrl = typeof booking.hosted_invoice_url === "string" ? booking.hosted_invoice_url : null;
  const existingId = typeof booking.stripe_invoice_id === "string" ? booking.stripe_invoice_id : null;
  const amount = Number(booking.deposit_cents || 0);
  if (amount <= 0) return existingUrl;

  const key = await resolveSecret(admin, "STRIPE_SECRET_KEY");
  if (!key) return existingUrl;

  const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" as never });

  if (existingId) {
    try {
      const inv = await stripe.invoices.retrieve(existingId);
      if (inv.status === "open" && inv.hosted_invoice_url) {
        await stripe.invoices.sendInvoice(existingId).catch(() => undefined);
        return inv.hosted_invoice_url;
      }
    } catch {
      /* create a replacement below */
    }
  }

  const email = String(booking.email || "").trim();
  if (!email) return existingUrl;

  let customerId =
    typeof booking.customer_id === "string" && booking.customer_id.startsWith("cus_")
      ? booking.customer_id
      : "";
  if (!customerId) {
    const found = await stripe.customers.list({ email, limit: 1 });
    customerId = found.data[0]?.id || "";
  }
  if (!customerId) {
    const created = await stripe.customers.create({
      email,
      name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || undefined,
      phone: String(booking.phone || "") || undefined,
    });
    customerId = created.id;
  }

  const description = `Novara deposit — booking ${booking.booking_number || booking.id}`;
  const item = await stripe.invoiceItems.create({
    customer: customerId,
    amount,
    currency: "usd",
    description,
  });
  try {
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: 1,
      pending_invoice_items_behavior: "include",
      description,
      metadata: {
        booking_id: String(booking.id),
        purpose: "deposit",
        reinstated: "true",
      },
      auto_advance: true,
      payment_settings: invoicePaymentSettingsSaveCard,
    });
    if (!invoice.id) throw new Error("Stripe did not return invoice id");
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: true });
    await stripe.invoices.sendInvoice(invoice.id);
    await admin
      .from("bookings")
      .update({
        stripe_invoice_id: invoice.id,
        hosted_invoice_url: finalized.hosted_invoice_url || existingUrl,
      })
      .eq("id", booking.id);
    return finalized.hosted_invoice_url || existingUrl;
  } catch (err) {
    if (item.id) await stripe.invoiceItems.del(item.id).catch(() => undefined);
    console.warn(
      "[admin-modify-booking] reissue invoice failed",
      err instanceof Error ? err.message : String(err),
    );
    return existingUrl;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const actorId = await ensureAdminOrVa(admin, req);
    const body = await req.json();
    const action = String(body.action || "update_service");
    const { bookingId, serviceType, homeSizeId, addOns, bedrooms, bathrooms, dwellingType, totalEstimateCents, addOnPrices } = body;
    if (!bookingId) throw new Error("bookingId is required");

    const { data: booking, error: bErr } = await admin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();
    if (bErr || !booking) throw new Error("Booking not found");

    // ── Customer personal info (name / email / phone / address) ────────
    // Allowed on any status — correcting a typo on a completed booking is
    // a records fix, not a service change. No customer "service updated"
    // SMS/email; GHL still gets a sync so the contact stays current.
    if (action === "update_customer_info") {
      const firstName = trimStr(body.firstName);
      const lastName = trimStr(body.lastName);
      const email = normalizeEmail(body.email);
      const phone = normalizePhone(body.phone);
      const address = trimStr(body.address);
      const city = trimStr(body.city);
      const state = trimStr(body.state);
      const zipCode = trimStr(body.zipCode ?? body.zip);

      if (!firstName) throw new Error("First name is required");
      if (!email || !email.includes("@")) throw new Error("A valid email is required");

      const bookingPatch: Record<string, unknown> = {
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        address,
        city,
        state,
        zip_code: zipCode,
        updated_at: new Date().toISOString(),
      };

      const { error: upErr } = await admin.from("bookings").update(bookingPatch).eq("id", bookingId);
      if (upErr) throw new Error(`Booking update failed: ${errMessage(upErr)}`);

      // Mirror onto the linked customer directory row when we can find it.
      // bookings.customer_id is text and sometimes holds a Stripe `cus_…`
      // id rather than the customers.id UUID, so only eq-by-id when it
      // looks like a UUID; otherwise match on the booking's previous email.
      // customers.address/city/state/zip/phone are nullable, so blank out to
      // NULL there rather than storing empty strings in the directory.
      const customerPatch: Record<string, unknown> = {
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zip: zipCode || null,
        updated_at: new Date().toISOString(),
      };
      const customerUuid =
        typeof booking.customer_id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            booking.customer_id,
          )
          ? booking.customer_id
          : null;
      const prevEmail = normalizeEmail(booking.email);
      if (customerUuid || prevEmail) {
        let custQ = admin.from("customers").update(customerPatch);
        custQ = customerUuid ? custQ.eq("id", customerUuid) : custQ.eq("email", prevEmail);
        const { error: custErr } = await custQ;
        if (custErr) {
          // A duplicate email here means another directory row already owns
          // it — the booking is still corrected, so don't fail the save.
          console.warn("[admin-modify-booking] customer mirror failed (non-blocking)", errMessage(custErr));
        }
      }

      // Keep the dispatch/job board address in sync with the booking. These
      // columns are NOT NULL too, hence the empty-string writes.
      if (booking.job_id) {
        const jobPatch: Record<string, unknown> = {
          address,
          city,
          state,
          zip: zipCode,
        };
        const { error: jobErr } = await admin.from("jobs").update(jobPatch).eq("id", booking.job_id);
        if (jobErr) {
          console.warn("[admin-modify-booking] job address mirror failed (non-blocking)", errMessage(jobErr));
        }
      }

      try {
        await admin.from("events").insert({
          event_type: "booking.customer_info_updated",
          source: "admin-modify-booking",
          summary: `Customer info updated on booking ${booking.booking_number || bookingId}`,
          data: {
            booking_id: bookingId,
            by: actorId,
            before: {
              first_name: booking.first_name,
              last_name: booking.last_name,
              email: booking.email,
              phone: booking.phone,
              address: booking.address,
              city: booking.city,
              state: booking.state,
              zip_code: booking.zip_code,
            },
            after: bookingPatch,
          },
        });
      } catch (evErr) {
        console.warn("[admin-modify-booking] event log failed (non-blocking)", evErr);
      }

      try {
        await admin.functions.invoke("send-zapier-webhook", { body: { bookingId } });
      } catch (e) {
        console.error("[admin-modify-booking] GHL sync failed (non-critical):", e);
      }

      console.log("[admin-modify-booking] customer info updated", { bookingId, actorId, email });
      return new Response(
        JSON.stringify({
          success: true,
          bookingId,
          customer: {
            first_name: firstName,
            last_name: lastName,
            email,
            phone,
            address,
            city,
            state,
            zip_code: zipCode,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // ── Access + internal notes for the assigned crew ─────────────────
    // Allowed on any status — a gate-code correction on a completed job
    // is still a records fix. No customer SMS/email. The cleaner portal
    // and checklist read these columns on the next load.
    if (action === "update_job_notes") {
      const NOTE_MAX = 2000;
      const accessNotes = String(body.accessNotes ?? body.access_notes ?? "").trim().slice(0, NOTE_MAX);
      const teamNotes = String(body.teamNotes ?? body.team_notes ?? "").trim().slice(0, NOTE_MAX);

      const bookingPatch: Record<string, unknown> = {
        access_notes: accessNotes || null,
        team_notes: teamNotes || null,
        updated_at: new Date().toISOString(),
      };

      const { error: upErr } = await admin.from("bookings").update(bookingPatch).eq("id", bookingId);
      if (upErr) throw new Error(`Booking update failed: ${errMessage(upErr)}`);

      // jobs.notes is what auto-dispatch seeds from access_notes. Keep it
      // aligned so the dispatch board / calendar don't show a stale code.
      if (booking.job_id) {
        const { error: jobErr } = await admin
          .from("jobs")
          .update({ notes: accessNotes || null })
          .eq("id", booking.job_id);
        if (jobErr) {
          console.warn("[admin-modify-booking] job notes mirror failed (non-blocking)", errMessage(jobErr));
        }
      }

      try {
        await admin.from("events").insert({
          event_type: "booking.job_notes_updated",
          source: "admin-modify-booking",
          summary: `Job notes updated on booking ${booking.booking_number || bookingId}`,
          data: {
            booking_id: bookingId,
            by: actorId,
            before: {
              access_notes: booking.access_notes || null,
              team_notes: booking.team_notes || null,
            },
            after: bookingPatch,
          },
        });
      } catch (evErr) {
        console.warn("[admin-modify-booking] event log failed (non-blocking)", evErr);
      }

      try {
        await admin.functions.invoke("send-zapier-webhook", { body: { bookingId } });
      } catch (e) {
        console.error("[admin-modify-booking] GHL sync failed (non-critical):", e);
      }

      console.log("[admin-modify-booking] job notes updated", { bookingId, actorId });
      return new Response(
        JSON.stringify({
          success: true,
          bookingId,
          access_notes: accessNotes || null,
          team_notes: teamNotes || null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    if (action === "reinstate_unpaid_deposit") {
      if (booking.status !== "cancelled") {
        throw new Error("Only cancelled bookings can be reinstated.");
      }
      if (booking.payment_received_at) {
        throw new Error("This booking already has a payment — reopen it as a new booking instead.");
      }
      const reason = String(booking.auto_cancelled_reason || booking.cancel_reason || "");
      const looksUnpaid =
        reason === "unpaid_deposit" ||
        /unpaid deposit/i.test(reason) ||
        Boolean(booking.hosted_invoice_url || booking.stripe_invoice_id);
      if (!looksUnpaid) {
        throw new Error("This cancelled booking is not an unpaid-deposit auto-cancel.");
      }

      const nowIso = new Date().toISOString();
      const noteLine = `Reinstated after unpaid-deposit auto-cancel ${nowIso.slice(0, 10)} (customer requested).`;
      const prevNotes = String(booking.team_notes || "").trim();
      const payUrl = await reissueDepositInvoice(admin, booking);

      const { error: upErr } = await admin
        .from("bookings")
        .update({
          status: "pending_payment",
          cancel_reason: null,
          cancelled_at: null,
          auto_cancelled_reason: null,
          cancel_fee_cents: 0,
          pending_deposit_started_at: nowIso,
          hosted_invoice_url: payUrl || booking.hosted_invoice_url || null,
          updated_at: nowIso,
          team_notes: prevNotes ? `${prevNotes}\n${noteLine}` : noteLine,
        })
        .eq("id", bookingId)
        .eq("status", "cancelled");
      if (upErr) throw new Error(`Reinstate failed: ${errMessage(upErr)}`);

      await admin
        .from("booking_emails_sent")
        .delete()
        .eq("booking_id", bookingId)
        .in("kind", [
          "pending_deposit_reminder_30m",
          "pending_deposit_reminder_2h",
          "pending_deposit_reminder_next_day_2h",
          "pending_deposit_auto_cancelled",
        ]);

      const money = `$${((Number(booking.deposit_cents) || 0) / 100).toFixed(2)}`;
      const when = [
        booking.service_date ? formatServiceDate(booking.service_date) : null,
        booking.time_slot ? formatTimeSlot(booking.time_slot) : null,
      ].filter(Boolean).join(" · ");
      const link = payUrl || booking.hosted_invoice_url;
      if (booking.phone) {
        await sendSms(admin, {
          toPhone: booking.phone,
          message:
            `Novara Cleaning: Your cleaning${when ? ` (${when})` : ""} is reopened and pending the ${money} deposit.` +
            (link ? ` Pay here: ${link}` : " Check your email for the invoice.") +
            ` Call ${SUPPORT_PHONE_DISPLAY} with questions.`,
          type: "confirmation",
        });
      }
      if (booking.email && link) {
        try {
          const resendKey = await resolveSecret(admin, "RESEND_API_KEY");
          if (resendKey) {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${resendKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: "Novara Cleaning <hello@novaracleaning.com>",
                to: [booking.email],
                subject: `Your Novara cleaning is reopened — deposit needed`,
                html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.55;max-width:560px">
                  <p>Hi ${booking.first_name || "there"},</p>
                  <p>We reopened your cleaning${when ? ` on <strong>${when}</strong>` : ""}. It stays pending until we receive the ${money} deposit.</p>
                  <p style="margin:20px 0"><a href="${link}" style="display:inline-block;background:#5C0FFE;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:600">Pay deposit ${money}</a></p>
                  <p style="font-size:12px;color:#94a3b8">Questions? Call ${SUPPORT_PHONE_DISPLAY}</p>
                </div>`,
              }),
            });
          }
        } catch (emailErr) {
          console.warn("[admin-modify-booking] reinstate email failed", emailErr);
        }
      }

      try {
        await admin.from("events").insert({
          event_type: "booking.reinstated_unpaid_deposit",
          source: "admin-modify-booking",
          summary: `Reinstated unpaid-deposit booking ${booking.booking_number || bookingId}`,
          data: { booking_id: bookingId, by: actorId, pay_url: payUrl },
        });
      } catch (evErr) {
        console.warn("[admin-modify-booking] event log failed (non-blocking)", evErr);
      }

      try {
        await admin.functions.invoke("send-zapier-webhook", { body: { bookingId } });
      } catch (e) {
        console.error("[admin-modify-booking] GHL sync failed (non-critical):", e);
      }

      return new Response(
        JSON.stringify({ success: true, bookingId, status: "pending_payment", payUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    if (action !== "update_service") {
      throw new Error(`Unknown action: ${action}`);
    }

    if (booking.status === "cancelled") throw new Error("Cannot modify a cancelled booking");
    if (booking.status === "completed") throw new Error("Cannot modify a completed booking");

    const newServiceType = serviceType || booking.service_type;
    const newHomeSize = homeSizeId || booking.home_size_id;
    const newAddOns = Array.isArray(addOns) ? addOns : (booking.add_ons || []);
    const newTotalCents = Number.isFinite(totalEstimateCents)
      ? Math.round(totalEstimateCents)
      : booking.total_estimate_cents;

    const prevTotalCents = Number(booking.total_estimate_cents || 0);

    // Optional per-add-on price overrides (dollars) from the admin UI. We
    // keep bookings.add_ons as the list of ids (downstream stays compatible)
    // and record the priced breakdown in team_notes for the ops record.
    const priceMap: Record<string, number> = (addOnPrices && typeof addOnPrices === "object")
      ? addOnPrices as Record<string, number>
      : {};
    const addOnBreakdown = (newAddOns as string[]).map((id) => {
      const dollars = Number(priceMap[id]);
      return Number.isFinite(dollars)
        ? `${addOnLabel(id)} ($${dollars.toFixed(2)})`
        : addOnLabel(id);
    });

    const update: Record<string, unknown> = {
      service_type: newServiceType,
      home_size_id: newHomeSize,
      add_ons: newAddOns,
      total_estimate_cents: newTotalCents,
      updated_at: new Date().toISOString(),
    };
    if (bedrooms !== undefined && bedrooms !== null) update.bedrooms = bedrooms;
    if (bathrooms !== undefined && bathrooms !== null) update.bathrooms = bathrooms;
    if (dwellingType !== undefined && dwellingType !== null) update.dwelling_type = dwellingType;
    if (addOnBreakdown.length > 0) {
      const prevNotes = (booking.team_notes as string | null) || "";
      const line = `Service adjusted ${new Date().toISOString().slice(0, 10)} — ` +
        `${SERVICE_LABELS[newServiceType] || newServiceType}; add-ons: ${addOnBreakdown.join(", ")}; ` +
        `total $${(Math.max(0, newTotalCents) / 100).toFixed(2)}.`;
      update.team_notes = prevNotes ? `${prevNotes}\n${line}` : line;
    }

    const { error: upErr } = await admin.from("bookings").update(update).eq("id", bookingId);
    if (upErr) throw new Error(`Booking update failed: ${errMessage(upErr)}`);

    if (booking.job_id) {
      try {
        await ensureJobChecklist(admin, {
          jobId: String(booking.job_id),
          bookingId,
          serviceType: String(newServiceType),
        });
      } catch (e) {
        console.warn("[admin-modify-booking] checklist sync failed (non-blocking)", e);
      }
    }
    await documentBookingAddonsInQcSafe(admin, {
      booking: { ...booking, ...update },
      source: "admin",
      addedIds: (newAddOns as string[]).filter((a) => !(booking.add_ons || []).includes(a)),
    });

    console.log("[admin-modify-booking] updated", { bookingId, actorId, newServiceType, newHomeSize, newTotalCents });

    // ── Notify the customer (SMS + email) ─────────────────────────────
    const svcLabel = SERVICE_LABELS[newServiceType] || newServiceType;
    const dollars = `$${(Math.max(0, newTotalCents) / 100).toFixed(2)}`;
    const priceDiffDollars = (newTotalCents - prevTotalCents) / 100;
    const dateLabel = booking.service_date
      ? new Date(`${booking.service_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      : "your scheduled date";

    // Human-readable add-on summary for the SMS (uses prices when provided).
    const addOnSummary = addOnBreakdown.length > 0
      ? addOnBreakdown.join(", ")
      : (newAddOns as string[]).length > 0
        ? (newAddOns as string[]).map(addOnLabel).join(", ")
        : "None";

    try {
      const diffLine = priceDiffDollars > 0
        ? ` (+$${priceDiffDollars.toFixed(2)})`
        : priceDiffDollars < 0
          ? ` (-$${Math.abs(priceDiffDollars).toFixed(2)})`
          : "";
      await sendSms(
        admin,
        booking.phone,
        `Novara Cleaning: Your cleaning${booking.service_date ? ` on ${dateLabel}` : ""} was updated to ${svcLabel}. ` +
          `Add-ons: ${addOnSummary}. New total: ${dollars}${diffLine}. Questions? Call ${SUPPORT_PHONE_DISPLAY}.`,
      );
      console.log("[admin-modify-booking] customer SMS sent");
    } catch (e) {
      console.error("[admin-modify-booking] SMS failed (non-blocking):", e);
    }

    try {
      await admin.functions.invoke("send-booking-email", {
        body: {
          email: booking.email,
          type: "modification",
          bookingData: {
            ...booking,
            service_type: newServiceType,
            home_size_id: newHomeSize,
            add_ons: newAddOns,
            total_estimate_cents: newTotalCents,
            priceDifference: priceDiffDollars.toFixed(2),
          },
        },
      });
      console.log("[admin-modify-booking] customer email sent");
    } catch (e) {
      console.error("[admin-modify-booking] email failed (non-blocking):", e);
    }

    // ── Sync the change to GHL (+ Airtable + LeadConnector) ───────────
    try {
      await admin.functions.invoke("send-zapier-webhook", { body: { bookingId } });
      console.log("[admin-modify-booking] GHL sync triggered");
    } catch (e) {
      console.error("[admin-modify-booking] GHL sync failed (non-critical):", e);
    }

    return new Response(
      JSON.stringify({ success: true, bookingId, totalEstimateCents: newTotalCents }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const msg = errMessage(error);
    console.error("[admin-modify-booking] ERROR", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
    );
  }
});
