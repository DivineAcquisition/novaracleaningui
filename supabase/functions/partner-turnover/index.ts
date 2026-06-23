import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { formatServiceDate } from "../_shared/sms.ts";
import {
  type SB, money, fmtWindow, sendPartnerEmail as sendHostEmail,
  runAssignment, notifyAssignment, loadContext, finalizeBatch,
} from "../_shared/turnover-engine.ts";

// --- Partner Turnover Portal - server engine -----------------------------
//
// All pricing, payment, and assignment runs here (never trust the client).
// Host writes go through this function (service role); hosts can only READ
// their own rows via RLS. Reuses the existing cleaners table, SMS sender
// (Telnyx), Discord notifier, and Stripe account.
//
// Actions:
//   host.ensure        -> upsert the host row for the signed-in user
//   property.save      -> create/update a property (NEVER sets price)
//   turnover.request   -> lock price, create request, return Stripe Checkout URL
//   turnover.finalize  -> verify payment server-side, then auto-assign + notify
//   turnover.cancel    -> host cancellation (24h cutoff)
//   admin.assign       -> admin manual (re)assign + re-notify (role-gated)
//   batch.checkout     -> book a whole week in one payment
//   batch.finalize     -> verify batch payment, assign every turnover
//   recurring.save     -> create/update a repeating weekly pattern
//   recurring.update   -> pause / resume / cancel a recurring schedule

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    ) as SB;

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(jwt);
    const userId: string | undefined = u?.user?.id;
    const userEmail: string | undefined = u?.user?.email?.toLowerCase();
    const userMeta = (u?.user?.user_metadata || {}) as Record<string, unknown>;
    const metaName = (userMeta.full_name as string) || (userMeta.name as string) ||
      [userMeta.first_name, userMeta.last_name].filter(Boolean).join(" ") || "";
    const metaPhone = (userMeta.phone as string) || "";
    if (!userId) return json({ error: "Not signed in" }, 401);

    const body = await req.json();
    const action: string = body.action;
    const origin = req.headers.get("origin") || "https://partner.novaracleaning.com";

    const getHost = async () => {
      const { data } = await admin.from("hosts").select("*").eq("user_id", userId).maybeSingle();
      return data;
    };

    // --- host.ensure ---------------------------------------------------
    if (action === "host.ensure") {
      let host = await getHost();
      if (!host) {
        const resolvedName = (body.name || metaName || "").trim() || null;
        const resolvedPhone = (body.phone || metaPhone || "").replace(/\D/g, "") || null;
        const { data, error } = await admin.from("hosts").insert({
          user_id: userId,
          email: userEmail,
          name: resolvedName,
          phone: resolvedPhone,
        }).select("*").single();
        if (error) return json({ error: error.message }, 500);
        host = data;
        // First-time host -> welcome email.
        await sendHostEmail(admin, "welcome", userEmail, {
          name: (resolvedName || "").split(" ")[0] || "",
        });
      } else if (body.name || body.phone || (!host.name && metaName) || (!host.phone && metaPhone)) {
        await admin.from("hosts").update({
          name: body.name?.trim() || host.name || metaName || null,
          phone: body.phone ? body.phone.replace(/\D/g, "") : (host.phone || (metaPhone ? metaPhone.replace(/\D/g, "") : null)),
        }).eq("id", host.id);
      }
      return json({ host });
    }

    const host = await getHost();
    if (!host && action !== "admin.assign") {
      return json({ error: "No host profile - call host.ensure first" }, 400);
    }

    // --- property.save (never accepts turnover_price) -------------------
    if (action === "property.save") {
      const fields = {
        host_id: host.id,
        nickname: (body.nickname || "").trim() || null,
        address: (body.address || "").trim() || null,
        access_instructions: (body.access_instructions || "").trim() || null,
        bedrooms: body.bedrooms != null && body.bedrooms !== "" ? parseInt(String(body.bedrooms), 10) : null,
        bathrooms: body.bathrooms != null && body.bathrooms !== "" ? parseFloat(String(body.bathrooms)) : null,
        sqft: body.sqft != null && body.sqft !== "" ? parseInt(String(body.sqft), 10) : null,
        laundry_included: !!body.laundry_included,
        restock_included: !!body.restock_included,
        special_notes: (body.special_notes || "").trim() || null,
      };
      if (body.propertyId) {
        // Ensure the property belongs to this host before updating.
        const { data: existing } = await admin.from("properties").select("id, host_id").eq("id", body.propertyId).maybeSingle();
        if (!existing || existing.host_id !== host.id) return json({ error: "Property not found" }, 404);
        const { data, error } = await admin.from("properties").update(fields).eq("id", body.propertyId).select("*").single();
        if (error) return json({ error: error.message }, 500);
        return json({ property: data });
      }
      const { data, error } = await admin.from("properties").insert(fields).select("*").single();
      if (error) return json({ error: error.message }, 500);
      return json({ property: data });
    }

    // --- turnover.request -----------------------------------------------
    if (action === "turnover.request") {
      const { data: property } = await admin.from("properties").select("*").eq("id", body.propertyId).maybeSingle();
      if (!property || property.host_id !== host.id) return json({ error: "Property not found" }, 404);
      if (property.turnover_price == null || Number(property.turnover_price) <= 0) {
        return json({ error: "This property isn't priced yet. Our team will set your per-turnover rate shortly." }, 409);
      }
      if (!body.requested_date) return json({ error: "requested_date required" }, 400);

      const priceCents = Math.round(Number(property.turnover_price) * 100);

      const { data: tr, error: trErr } = await admin.from("turnover_requests").insert({
        property_id: property.id,
        host_id: host.id,
        requested_date: body.requested_date,
        window_start: body.window_start || null,
        window_end: body.window_end || null,
        price: Number(property.turnover_price),
        status: "pending_payment",
        notes: (body.notes || "").trim() || null,
      }).select("*").single();
      if (trErr) return json({ error: trErr.message }, 500);

      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      // Reuse / create the host's Stripe customer for one-tap repeat booking.
      let customerId = host.stripe_customer_id || undefined;
      if (!customerId && host.email) {
        const list = await stripe.customers.list({ email: host.email, limit: 1 });
        customerId = list.data[0]?.id;
        if (!customerId) {
          const c = await stripe.customers.create({ email: host.email, name: host.name || undefined });
          customerId = c.id;
        }
        await admin.from("hosts").update({ stripe_customer_id: customerId }).eq("id", host.id);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : host.email,
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: `Turnover - ${property.nickname || property.address || "Property"}` },
            unit_amount: priceCents,
          },
          quantity: 1,
        }],
        success_url: `${origin}/partner/turnover/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/partner/dashboard`,
        payment_intent_data: { setup_future_usage: "off_session" },
        metadata: { kind: "turnover", turnover_id: tr.id, host_id: host.id },
      });

      await admin.from("turnover_requests").update({ stripe_checkout_session_id: session.id }).eq("id", tr.id);
      return json({ url: session.url, turnoverId: tr.id });
    }

    // --- turnover.finalize (verify payment server-side -> assign + notify) -
    if (action === "turnover.finalize") {
      if (!body.sessionId) return json({ error: "sessionId required" }, 400);
      const { data: tr } = await admin.from("turnover_requests").select("*").eq("stripe_checkout_session_id", body.sessionId).maybeSingle();
      if (!tr) return json({ error: "Turnover not found" }, 404);

      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const session = await stripe.checkout.sessions.retrieve(body.sessionId);
      const paid = session.payment_status === "paid" || session.status === "complete";

      if (paid && tr.status === "pending_payment") {
        await admin.from("turnover_requests").update({
          status: "paid",
          paid_at: new Date().toISOString(),
          stripe_payment_intent_id: (session.payment_intent as string) || null,
        }).eq("id", tr.id).eq("status", "pending_payment");
        // Payment-received confirmation email to the host.
        const { property: paidProp, hostRow: paidHost } = await loadContext(admin, tr);
        await sendHostEmail(admin, "turnover_confirmed", paidHost?.email, {
          name: (paidHost?.name || "").split(" ")[0] || "",
          property: paidProp?.nickname || paidProp?.address || "",
          address: paidProp?.address || "",
          date: formatServiceDate(tr.requested_date as string),
          window: fmtWindow(tr.window_start as string, tr.window_end as string),
          price: money(Number(tr.price || 0)),
        });
        // Run assignment on the freshly-paid request.
        const { data: fresh } = await admin.from("turnover_requests").select("*").eq("id", tr.id).single();
        await runAssignment(admin, fresh);
        const { data: after } = await admin.from("turnover_requests").select("status, assignment_type").eq("id", tr.id).single();
        return json({ paid: true, status: after?.status, assignment_type: after?.assignment_type });
      }
      return json({ paid, status: tr.status });
    }

    // --- turnover.cancel (host) -----------------------------------------
    if (action === "turnover.cancel") {
      const { data: tr } = await admin.from("turnover_requests").select("*").eq("id", body.turnoverId).maybeSingle();
      if (!tr || tr.host_id !== host.id) return json({ error: "Turnover not found" }, 404);
      if (["completed", "cancelled"].includes(tr.status)) return json({ error: "Already closed" }, 409);
      // Cancellation cutoff: no self-cancel within 24h of the service date.
      const svc = new Date(`${tr.requested_date}T12:00:00`);
      if (svc.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
        return json({ error: "Within 24 hours of service - contact support to cancel." }, 409);
      }
      await admin.from("turnover_requests").update({ status: "cancelled" }).eq("id", tr.id);
      const { property: cProp } = await loadContext(admin, tr);
      await sendHostEmail(admin, "turnover_cancelled", host.email, {
        name: (host.name || "").split(" ")[0] || "",
        property: cProp?.nickname || cProp?.address || "",
        date: formatServiceDate(tr.requested_date as string),
      });
      return json({ ok: true });
    }

    // --- admin.assign (role-gated manual override) ----------------------
    if (action === "admin.assign") {
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
      const isAdmin = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
      if (!isAdmin) return json({ error: "Admins or VAs only" }, 403);

      const { data: tr } = await admin.from("turnover_requests").select("*").eq("id", body.turnoverId).maybeSingle();
      if (!tr) return json({ error: "Turnover not found" }, 404);

      if (body.cleanerId) {
        await admin.from("turnover_requests").update({
          assigned_cleaner_id: body.cleanerId,
          assignment_type: "manual",
          status: "assigned",
          assigned_at: new Date().toISOString(),
          assigned_by: userId,
        }).eq("id", tr.id);
        const { data: fresh } = await admin.from("turnover_requests").select("*").eq("id", tr.id).single();
        await notifyAssignment(admin, fresh);
        return json({ status: "assigned", assignment_type: "manual" });
      }
      // No cleaner specified -> re-run the auto engine.
      await admin.from("turnover_requests").update({ assigned_by: userId }).eq("id", tr.id);
      await runAssignment(admin, tr);
      const { data: after } = await admin.from("turnover_requests").select("status, assignment_type").eq("id", tr.id).single();
      return json({ status: after?.status, assignment_type: after?.assignment_type });
    }

    // --- batch.checkout (whole week, one payment) -----------------------
    if (action === "batch.checkout") {
      const lines: Array<{ propertyId: string; date: string; window_start?: string; window_end?: string }> = Array.isArray(body.lines) ? body.lines : [];
      if (!body.weekStart || lines.length === 0) return json({ error: "weekStart and at least one line required" }, 400);

      // Server-authoritative pricing: re-read each property's current price.
      const priced: Array<{ propertyId: string; date: string; ws: string | null; we: string | null; price: number }> = [];
      let total = 0;
      for (const ln of lines) {
        if (!ln.propertyId || !ln.date) return json({ error: "Each line needs propertyId and date" }, 400);
        const { data: property } = await admin.from("properties").select("id, host_id, turnover_price").eq("id", ln.propertyId).maybeSingle();
        if (!property || property.host_id !== host.id) return json({ error: "Property not found" }, 404);
        if (property.turnover_price == null || Number(property.turnover_price) <= 0) {
          return json({ error: "One of your properties isn't priced yet." }, 409);
        }
        const price = Number(property.turnover_price);
        total += price;
        priced.push({ propertyId: ln.propertyId, date: ln.date, ws: ln.window_start || null, we: ln.window_end || null, price });
      }

      const { data: batch, error: bErr } = await admin.from("booking_batches").insert({
        host_id: host.id,
        week_start: body.weekStart,
        source: "manual",
        turnover_count: priced.length,
        total_amount: total,
        status: "pending_payment",
      }).select("*").single();
      if (bErr) return json({ error: bErr.message }, 500);

      // Create a pending turnover per line, grouped by batch_id.
      const rows = priced.map((p) => ({
        property_id: p.propertyId, host_id: host.id, requested_date: p.date,
        window_start: p.ws, window_end: p.we, price: p.price, status: "pending_payment", batch_id: batch.id,
      }));
      const { error: trErr } = await admin.from("turnover_requests").insert(rows);
      if (trErr) return json({ error: trErr.message }, 500);

      // Optionally persist repeat-weekly patterns from flagged rows.
      const repeat: Array<{ propertyId: string; days_of_week: number[]; window_start?: string; window_end?: string }> = Array.isArray(body.repeat) ? body.repeat : [];
      for (const r of repeat) {
        const { data: property } = await admin.from("properties").select("id, host_id, turnover_price").eq("id", r.propertyId).maybeSingle();
        if (property && property.host_id === host.id && property.turnover_price != null) {
          await admin.from("recurring_schedules").insert({
            host_id: host.id, property_id: r.propertyId,
            days_of_week: r.days_of_week || [], window_start: r.window_start || null, window_end: r.window_end || null,
            price_snapshot: Number(property.turnover_price), active: true,
          });
        }
      }

      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      let customerId = host.stripe_customer_id || undefined;
      if (!customerId && host.email) {
        const list = await stripe.customers.list({ email: host.email, limit: 1 });
        customerId = list.data[0]?.id || (await stripe.customers.create({ email: host.email, name: host.name || undefined })).id;
        await admin.from("hosts").update({ stripe_customer_id: customerId }).eq("id", host.id);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : host.email,
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: `Weekly turnovers (${priced.length}) - week of ${body.weekStart}` },
            unit_amount: Math.round(total * 100),
          },
          quantity: 1,
        }],
        success_url: `${origin}/partner/turnover/batch-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/partner/dashboard`,
        payment_intent_data: { setup_future_usage: "off_session" },
        metadata: { kind: "turnover_batch", batch_id: batch.id, host_id: host.id },
      });
      await admin.from("booking_batches").update({ stripe_checkout_session_id: session.id }).eq("id", batch.id);
      return json({ url: session.url, batchId: batch.id });
    }

    // --- batch.finalize (verify payment, then assign every turnover) -----
    if (action === "batch.finalize") {
      if (!body.sessionId) return json({ error: "sessionId required" }, 400);
      const { data: batch } = await admin.from("booking_batches").select("*").eq("stripe_checkout_session_id", body.sessionId).maybeSingle();
      if (!batch) return json({ error: "Batch not found" }, 404);

      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const session = await stripe.checkout.sessions.retrieve(body.sessionId);
      const paid = session.payment_status === "paid" || session.status === "complete";

      if (paid && batch.status === "pending_payment") {
        await admin.from("booking_batches").update({
          status: "paid", stripe_payment_intent_id: (session.payment_intent as string) || null,
        }).eq("id", batch.id).eq("status", "pending_payment");
        await finalizeBatch(admin, batch.id);
      }
      const { data: after } = await admin.from("booking_batches").select("status, turnover_count, total_amount, week_start").eq("id", batch.id).single();
      return json({ paid, status: after?.status, count: after?.turnover_count, total: after?.total_amount, weekStart: after?.week_start });
    }

    // --- recurring.save (create/update a weekly pattern) -----------------
    if (action === "recurring.save") {
      const { data: property } = await admin.from("properties").select("id, host_id, turnover_price").eq("id", body.propertyId).maybeSingle();
      if (!property || property.host_id !== host.id) return json({ error: "Property not found" }, 404);
      if (property.turnover_price == null || Number(property.turnover_price) <= 0) return json({ error: "Property isn't priced yet." }, 409);
      const fields = {
        host_id: host.id, property_id: body.propertyId,
        days_of_week: Array.isArray(body.days_of_week) ? body.days_of_week : [],
        window_start: body.window_start || null, window_end: body.window_end || null,
        price_snapshot: Number(property.turnover_price), active: true,
      };
      if (body.scheduleId) {
        const { data: ex } = await admin.from("recurring_schedules").select("id, host_id").eq("id", body.scheduleId).maybeSingle();
        if (!ex || ex.host_id !== host.id) return json({ error: "Schedule not found" }, 404);
        const { data, error } = await admin.from("recurring_schedules").update(fields).eq("id", body.scheduleId).select("*").single();
        if (error) return json({ error: error.message }, 500);
        return json({ schedule: data });
      }
      const { data, error } = await admin.from("recurring_schedules").insert(fields).select("*").single();
      if (error) return json({ error: error.message }, 500);
      return json({ schedule: data });
    }

    // --- recurring.update (pause / resume / cancel) ----------------------
    if (action === "recurring.update") {
      const { data: sch } = await admin.from("recurring_schedules").select("*").eq("id", body.scheduleId).maybeSingle();
      if (!sch || sch.host_id !== host.id) return json({ error: "Schedule not found" }, 404);
      const upd: Record<string, unknown> = {};
      if (body.op === "cancel") upd.active = false;
      else if (body.op === "resume") { upd.active = true; upd.paused_until = null; }
      else if (body.op === "pause") upd.paused_until = body.paused_until || null;
      else return json({ error: "Unknown op" }, 400);
      await admin.from("recurring_schedules").update(upd).eq("id", sch.id);
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
