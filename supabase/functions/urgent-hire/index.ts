// urgent-hire
//
// Admin-initiated last-resort broadcast to qualified pipeline applicants
// (valid photo ID + own vehicle, Screening-Passed+, not Active) when a job
// needs coverage beyond the backup pool. Radius is mileage copy, not a
// cutoff. Public token actions (get / accept) reuse the same first-claim-wins
// RPC pattern as coverage offers.
//
// Actions:
//   preview / send / log / get_settings / save_settings / cancel  (admin/VA)
//   get / accept / mark_viewed                                     (token)
//   expire                                                         (cron / coverage-runner)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { haversineMiles } from "../_shared/dispatch-scoring.ts";
import { notifyDiscord } from "../_shared/discord.ts";
import { jobValueForPay } from "../_shared/reclean.ts";
import { formatServiceDate, formatTimeSlot, sendSms } from "../_shared/sms.ts";
import {
  APPLIED_IN_PAST_ACK,
  buildUrgentHireSms,
  dollarsFromCents,
  firstJobOnlySentence,
  formatUrgentHireMileageLine,
  isActiveRosterStatus,
  isUrgentHirePipelineStage,
  mintHexToken,
  parseUrgentHireSettings,
  payoutsReady,
  remainingUrgentHireSteps,
  screeningQualifiersPass,
  serviceTypeLabel,
  supplyChecklistValid,
  unfilledStillNeedsCoverage,
  urgentHireErrorMessage,
  urgentHireOfferUrl,
  urgentHirePayCents,
  usablePhone,
  URGENT_HIRE_DEFAULTS,
  URGENT_HIRE_ELIGIBLE_STAGES,
  URGENT_HIRE_PORTAL_BASE,
  URGENT_HIRE_SETTINGS_KEY,
  zoneLabel,
  type UrgentHireSettings,
} from "../_shared/urgent-hire.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const log = (s: string, d?: unknown) =>
  console.log(`[urgent-hire] ${s}${d ? ` ${JSON.stringify(d)}` : ""}`);

function json(payload: unknown, status = 200): Response {
  const body =
    payload && typeof payload === "object"
      ? { ...(payload as Record<string, unknown>) }
      : payload;
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    (body as { error?: unknown }).error != null &&
    typeof (body as { error?: unknown }).error !== "string"
  ) {
    (body as { error: string }).error = urgentHireErrorMessage((body as { error: unknown }).error);
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type SB = any;

async function ensureAdminOrVa(admin: SB, jwt: string): Promise<{ id: string; email: string }> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
  return { id: u.user.id, email: u.user.email || "" };
}

async function loadSettings(admin: SB): Promise<UrgentHireSettings> {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", URGENT_HIRE_SETTINGS_KEY)
    .maybeSingle();
  return parseUrgentHireSettings(data?.value);
}

async function logEvent(
  admin: SB,
  args: {
    type: string;
    summary: string;
    jobId?: string | null;
    cleanerId?: string | null;
    bookingId?: string | null;
    data?: Record<string, unknown>;
  },
) {
  await admin.from("events").insert({
    event_type: args.type,
    source: "urgent-hire",
    job_id: args.jobId || null,
    cleaner_id: args.cleanerId || null,
    booking_id: args.bookingId || null,
    summary: args.summary,
    data: args.data || {},
  }).then(() => undefined, () => undefined);
}

interface JobBundle {
  job: Record<string, unknown>;
  booking: Record<string, unknown> | null;
}

async function loadJobBundle(admin: SB, jobId: string): Promise<JobBundle> {
  const { data: job, error } = await admin
    .from("jobs")
    .select(
      "id, status, service_type, start_datetime, duration_est_hours, address, city, state, zip, lat, lng, min_cleaners_required",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!job) throw new Error("Job not found.");
  const { data: booking } = await admin
    .from("bookings")
    .select(
      "id, booking_number, job_id, status, service_date, time_slot, arrival_window, service_type, first_name, last_name, city, state, zip_code, address, total_estimate_cents, final_charge_cents, is_reclean, reclean_assessed_value_cents",
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { job, booking: booking || null };
}

async function resolveJobCoords(admin: SB, bundle: JobBundle): Promise<{ lat: number; lng: number } | null> {
  const job = bundle.job;
  if (job.lat && job.lng) return { lat: Number(job.lat), lng: Number(job.lng) };
  const booking = bundle.booking;
  try {
    const geo = await admin.functions.invoke("geocode-address", {
      body: {
        address: booking?.address || job.address,
        city: booking?.city || job.city,
        state: booking?.state || job.state,
        zip: booking?.zip_code || job.zip,
      },
    });
    const g = (geo?.data as { lat?: number; lng?: number }) || {};
    if (g.lat && g.lng) {
      await admin.from("jobs").update({ lat: g.lat, lng: g.lng }).eq("id", job.id);
      return { lat: g.lat, lng: g.lng };
    }
  } catch (err) {
    log("geocode job failed", err instanceof Error ? err.message : String(err));
  }
  return null;
}

async function coordsForZip(admin: SB, zip: string | null | undefined): Promise<{ lat: number; lng: number } | null> {
  const z = String(zip || "").replace(/\D/g, "").slice(0, 5);
  if (z.length !== 5) return null;
  const { data: cached } = await admin
    .from("geocode_cache")
    .select("lat, lng")
    .eq("zip", z)
    .not("lat", "is", null)
    .limit(1)
    .maybeSingle();
  if (cached?.lat && cached?.lng) return { lat: Number(cached.lat), lng: Number(cached.lng) };
  try {
    const geo = await admin.functions.invoke("geocode-address", { body: { zip: z, address: z } });
    const g = (geo?.data as { lat?: number; lng?: number }) || {};
    if (g.lat && g.lng) return { lat: g.lat, lng: g.lng };
  } catch {
    /* zip geocode is best-effort */
  }
  return null;
}

interface EligibleRow {
  applicantId: string;
  cleanerId: string | null;
  name: string;
  firstName: string;
  email: string | null;
  phone: string | null;
  zip: string | null;
  stage: string;
  distanceMiles: number | null;
  hadValidChecklist: boolean;
  remaining: string[];
}

async function findEligible(
  admin: SB,
  jobCoords: { lat: number; lng: number } | null,
  settings: UrgentHireSettings,
): Promise<{ eligible: EligibleRow[]; unknownMileage: number }> {
  const { data: applicants, error } = await admin
    .from("cleaner_applicants")
    .select(
      "id, email, phone, full_name, first_name, last_name, zip_code, stage, cleaner_id",
    )
    .in("stage", [...URGENT_HIRE_ELIGIBLE_STAGES]);
  if (error) throw error;

  const rows = (applicants || []) as Record<string, unknown>[];
  if (rows.length === 0) return { eligible: [], unknownMileage: 0 };

  const applicantIds = rows.map((r) => String(r.id));
  const cleanerIds = rows.map((r) => r.cleaner_id).filter(Boolean).map(String);

  const [{ data: screenings }, { data: cleaners }, { data: activeRoster }] = await Promise.all([
    admin
      .from("phone_screenings")
      .select("applicant_id, recommendation, answers, submitted_at, status")
      .in("applicant_id", applicantIds)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false }),
    cleanerIds.length
      ? admin
        .from("cleaners")
        .select(
          "id, status, home_lat, home_lng, home_zip, supply_inventory, supply_checklist_submitted_at, ob_agreement_signed, ob_payouts_setup, payouts_enabled, stripe_account_id, first_name, last_name, email, phone",
        )
        .in("id", cleanerIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    admin.from("cleaners").select("email, status").eq("status", "active"),
  ]);

  const latestScreening = new Map<string, Record<string, unknown>>();
  for (const s of (screenings || []) as Record<string, unknown>[]) {
    const id = String(s.applicant_id || "");
    if (id && !latestScreening.has(id)) latestScreening.set(id, s);
  }
  const cleanerById = new Map<string, Record<string, unknown>>();
  for (const c of (cleaners || []) as Record<string, unknown>[]) {
    cleanerById.set(String(c.id), c);
  }
  const activeEmails = new Set<string>();
  for (const c of (activeRoster || []) as Record<string, unknown>[]) {
    if (isActiveRosterStatus(String(c.status || ""))) {
      const email = String(c.email || "").trim().toLowerCase();
      if (email) activeEmails.add(email);
    }
  }

  const eligible: EligibleRow[] = [];
  let unknownMileage = 0;

  for (const a of rows) {
    const stage = String(a.stage || "");
    if (!isUrgentHirePipelineStage(stage)) continue;

    const screening = latestScreening.get(String(a.id));
    if (!screening) continue;
    if (String(screening.recommendation || "") === "decline") continue;
    if (!screeningQualifiersPass(screening.answers)) continue;

    const cleaner = a.cleaner_id ? cleanerById.get(String(a.cleaner_id)) : null;
    if (cleaner && isActiveRosterStatus(String(cleaner.status || ""))) continue;
    const email = String(a.email || "").trim().toLowerCase();
    if (email && activeEmails.has(email)) continue;

    let distanceMiles: number | null = null;
    if (jobCoords) {
      let lat: number | null = cleaner?.home_lat != null ? Number(cleaner.home_lat) : null;
      let lng: number | null = cleaner?.home_lng != null ? Number(cleaner.home_lng) : null;
      if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        const zip = String(cleaner?.home_zip || a.zip_code || "").trim();
        const fromZip = await coordsForZip(admin, zip);
        if (fromZip) {
          lat = fromZip.lat;
          lng = fromZip.lng;
        }
      }
      if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
        const miles = haversineMiles(lat, lng, jobCoords.lat, jobCoords.lng);
        if (Number.isFinite(miles) && miles >= 0) {
          distanceMiles = Math.round(miles * 10) / 10;
        }
      }
    }
    if (distanceMiles == null) unknownMileage += 1;

    const checklist = supplyChecklistValid({
      inventory: (cleaner?.supply_inventory || {}) as Record<string, boolean>,
      submittedAt: (cleaner?.supply_checklist_submitted_at as string | null) || null,
      freshnessDays: settings.checklist_freshness_days,
    });
    const remaining = remainingUrgentHireSteps({
      checklistValid: checklist.valid,
      agreementSigned: Boolean(cleaner?.ob_agreement_signed),
      payoutsReady: payoutsReady(cleaner || {}),
    });

    const first = String(a.first_name || cleaner?.first_name || "").trim();
    const last = String(a.last_name || cleaner?.last_name || "").trim();
    const name = String(a.full_name || `${first} ${last}`.trim() || "Applicant");

    eligible.push({
      applicantId: String(a.id),
      cleanerId: a.cleaner_id ? String(a.cleaner_id) : null,
      name,
      firstName: first || name.split(" ")[0] || "there",
      email: (a.email as string | null) || (cleaner?.email as string | null) || null,
      phone: (a.phone as string | null) || (cleaner?.phone as string | null) || null,
      zip: (a.zip_code as string | null) || (cleaner?.home_zip as string | null) || null,
      stage,
      distanceMiles,
      hadValidChecklist: checklist.valid,
      remaining,
    });
  }

  eligible.sort((x, y) => {
    if (x.distanceMiles == null && y.distanceMiles == null) return 0;
    if (x.distanceMiles == null) return 1;
    if (y.distanceMiles == null) return -1;
    return x.distanceMiles - y.distanceMiles;
  });
  return { eligible, unknownMileage };
}

async function ensurePendingCleaner(
  admin: SB,
  applicant: EligibleRow,
): Promise<string> {
  if (applicant.cleanerId) {
    const { data } = await admin
      .from("cleaners")
      .select("id, status")
      .eq("id", applicant.cleanerId)
      .maybeSingle();
    if (data?.id) {
      const st = String(data.status || "").toLowerCase();
      if (st === "inactive" || st === "pending" || !st) {
        await admin
          .from("cleaners")
          .update({
            status: "pending",
            approved: false,
            available_for_bookings: false,
            deactivated_at: null,
            deactivation_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", data.id);
      }
      if (applicant.stage === "screening") {
        await admin
          .from("cleaner_applicants")
          .update({
            stage: "onboarding",
            updated_at: new Date().toISOString(),
          })
          .eq("id", applicant.applicantId);
      }
      return String(data.id);
    }
  }

  if (applicant.email) {
    const { data: found } = await admin
      .from("cleaners")
      .select("id, status")
      .ilike("email", applicant.email)
      .maybeSingle();
    if (found?.id) {
      if (isActiveRosterStatus(String(found.status || ""))) {
        throw new Error("This applicant is already on the Active roster.");
      }
      await admin
        .from("cleaner_applicants")
        .update({
          cleaner_id: found.id,
          stage: applicant.stage === "screening" ? "onboarding" : applicant.stage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", applicant.applicantId);
      return String(found.id);
    }
  }

  const nameParts = applicant.name.split(/\s+/);
  const { data: created, error } = await admin
    .from("cleaners")
    .insert({
      first_name: applicant.firstName || nameParts[0] || null,
      last_name: nameParts.slice(1).join(" ") || null,
      email: applicant.email,
      phone: applicant.phone,
      home_zip: applicant.zip,
      status: "pending",
      approved: false,
      onboarding_complete: false,
      available_for_bookings: false,
      invited_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !created?.id) throw new Error(error?.message || "Could not create contractor record.");

  await admin
    .from("cleaner_applicants")
    .update({
      cleaner_id: created.id,
      stage: applicant.stage === "screening" ? "onboarding" : applicant.stage,
      onboarding_launched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicant.applicantId);

  return String(created.id);
}

async function mintOnboardingTokens(admin: SB, cleanerId: string): Promise<{
  supplyToken: string | null;
  agreementToken: string | null;
  setupToken: string | null;
}> {
  const { data: cleaner } = await admin
    .from("cleaners")
    .select(
      "supply_token, supply_token_expires_at, agreement_token, agreement_token_expires_at, setup_token, setup_token_expires_at, ob_agreement_signed, ob_payouts_setup, payouts_enabled, stripe_account_id",
    )
    .eq("id", cleanerId)
    .maybeSingle();

  const live = (token: string | null | undefined, exp: string | null | undefined) => {
    if (!token) return null;
    if (exp && new Date(exp).getTime() < Date.now()) return null;
    return token;
  };

  let supplyToken = live(cleaner?.supply_token, cleaner?.supply_token_expires_at);
  let agreementToken = live(cleaner?.agreement_token, cleaner?.agreement_token_expires_at);
  let setupToken = live(cleaner?.setup_token, cleaner?.setup_token_expires_at);

  if (!supplyToken) {
    const { data } = await admin.rpc("mint_cleaner_supply_token", {
      p_cleaner_id: cleanerId,
      p_ttl_days: 30,
    });
    supplyToken = data ? String(data) : null;
  }
  if (!cleaner?.ob_agreement_signed && !agreementToken) {
    const { data } = await admin.rpc("mint_cleaner_agreement_token", {
      p_cleaner_id: cleanerId,
      p_ttl_days: 30,
    });
    agreementToken = data ? String(data) : null;
  }
  if (!payoutsReady(cleaner || {}) && !setupToken) {
    const { data } = await admin.rpc("mint_cleaner_setup_token", {
      p_cleaner_id: cleanerId,
      p_ttl_days: 14,
    });
    setupToken = data ? String(data) : null;
  }

  return { supplyToken, agreementToken, setupToken };
}

function jobWhen(bundle: JobBundle): { dateLabel: string; timeWindow: string } {
  const booking = bundle.booking;
  const job = bundle.job;
  const dateRaw = String(booking?.service_date || "").slice(0, 10);
  let dateLabel = dateRaw ? formatServiceDate(dateRaw) : "";
  if (!dateLabel && job.start_datetime) {
    dateLabel = new Date(String(job.start_datetime)).toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  const timeWindow = String(
    booking?.arrival_window || formatTimeSlot(String(booking?.time_slot || "")) || "",
  ).trim();
  return { dateLabel: dateLabel || "Upcoming", timeWindow };
}

function offerCopyFor(
  bundle: JobBundle,
  settings: UrgentHireSettings,
  payCents: number,
  token: string,
  needsChecklist: boolean,
  miles: number | null,
) {
  const { dateLabel, timeWindow } = jobWhen(bundle);
  const service = serviceTypeLabel(String(bundle.booking?.service_type || bundle.job.service_type || ""));
  const zone = zoneLabel(
    String(bundle.booking?.city || bundle.job.city || ""),
    String(bundle.booking?.zip_code || bundle.job.zip || ""),
  );
  return {
    serviceType: service,
    dateLabel,
    timeWindow,
    zone,
    payPercent: settings.pay_percent,
    payDollars: dollarsFromCents(payCents),
    firstJobOnly: settings.first_job_only,
    offerUrl: urgentHireOfferUrl(token),
    needsChecklist,
    miles,
    radiusMiles: settings.radius_miles,
  };
}

async function sendOfferComms(
  admin: SB,
  row: EligibleRow,
  copy: ReturnType<typeof offerCopyFor>,
): Promise<{ sms: boolean; email: boolean; error: string | null }> {
  let sms = false;
  let email = false;
  const errors: string[] = [];
  const phone = usablePhone(row.phone);
  if (phone) {
    sms = await sendSms(admin, {
      toPhone: phone,
      message: buildUrgentHireSms(copy),
      type: "job_offer",
    });
    if (!sms) errors.push("SMS failed");
  } else if (row.phone) {
    errors.push("Phone isn't sendable");
  }

  if (row.email) {
    try {
      const { data, error } = await admin.functions.invoke("send-cleaner-email", {
        body: {
          type: "urgent_hire",
          email: row.email,
          data: {
            firstName: row.firstName,
            serviceType: copy.serviceType,
            dateLabel: copy.dateLabel,
            timeWindow: copy.timeWindow,
            zone: copy.zone,
            payPercent: copy.payPercent,
            payDollars: copy.payDollars,
            firstJobOnly: copy.firstJobOnly,
            firstJobNote: firstJobOnlySentence(copy.firstJobOnly, copy.payPercent),
            offerUrl: copy.offerUrl,
            needsChecklist: copy.needsChecklist,
            appliedAck: APPLIED_IN_PAST_ACK,
            mileageLine: formatUrgentHireMileageLine(
              copy.miles,
              copy.radiusMiles ?? URGENT_HIRE_DEFAULTS.radius_miles,
            ),
          },
        },
      });
      const failed = error || (data && (data as { error?: string }).error);
      email = !failed;
      if (failed) errors.push("Email failed");
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Email failed");
    }
  }

  return { sms, email, error: errors.length ? errors.join("; ") : null };
}

async function activateForUrgentHire(admin: SB, cleanerId: string, applicantId: string) {
  await admin
    .from("cleaners")
    .update({
      status: "active",
      approved: true,
      available_for_bookings: true,
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", cleanerId);

  await admin
    .from("cleaner_applicants")
    .update({
      stage: "active",
      stage_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicantId);
}

/** If assignment fails after claim+activate, put them back in the pipeline. Progress stays. */
async function revertUrgentHireActivation(admin: SB, cleanerId: string, applicantId: string) {
  await admin
    .from("cleaners")
    .update({
      status: "pending",
      approved: false,
      available_for_bookings: false,
      activated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cleanerId);

  await admin
    .from("cleaner_applicants")
    .update({
      stage: "onboarding",
      updated_at: new Date().toISOString(),
    })
    .eq("id", applicantId);
}

async function assignWinner(
  admin: SB,
  opts: {
    bookingId: string;
    jobId: string;
    cleanerId: string;
    cleanerName: string;
    payCents: number;
    payPercent: number;
  },
): Promise<string | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const res = await fetch(`${supabaseUrl}/functions/v1/admin-booking-assign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify({
      bookingId: opts.bookingId,
      cleanerIds: [opts.cleanerId],
      mode: "replace",
      notify: true,
      allowUnpaid: true,
      actorName: `${opts.cleanerName} (accepted Urgent Hire)`,
      bufferOverrideReason:
        "Urgent Hire accepted by a pipeline applicant — the alternative was an uncovered job.",
      payoutCentsByCleaner: { [opts.cleanerId]: opts.payCents },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || body?.error) {
    return String(body?.error || `assign failed (${res.status})`);
  }

  const { data: assigns } = await admin
    .from("job_assignments")
    .select("id")
    .eq("cleaner_id", opts.cleanerId)
    .eq("job_id", opts.jobId)
    .in("status", ["Confirmed", "Accepted", "accepted"]);

  for (const a of assigns || []) {
    await admin
      .from("job_assignments")
      .update({
        pay_percentage_snapshot: opts.payPercent,
        estimated_pay_cents: opts.payCents,
        pay_source: "urgent_hire",
      })
      .eq("id", a.id)
      .eq("cleaner_id", opts.cleanerId);
  }
  return null;
}

async function notifyLosers(admin: SB, broadcastId: string, winnerOfferId: string) {
  const { data: losers } = await admin
    .from("urgent_hire_offers")
    .select("id, applicant_phone, applicant_name")
    .eq("broadcast_id", broadcastId)
    .eq("status", "withdrawn");

  for (const row of losers || []) {
    const phone = usablePhone(row.applicant_phone);
    if (!phone) continue;
    await sendSms(admin, {
      toPhone: phone,
      message:
        "Novara: that Urgent Hire job is no longer available — someone else finished first. Your onboarding progress is saved; you're still in the pipeline.",
      type: "confirmation",
    });
  }
  log("losers notified", { broadcastId, winnerOfferId, count: (losers || []).length });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").toLowerCase();
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

    const needsAdmin = ["preview", "send", "log", "get_settings", "save_settings", "cancel"].includes(action);
    let actor: { id: string; email: string } | null = null;
    if (needsAdmin) {
      if (!jwt) return json({ error: "Not signed in.", ok: false }, 401);
      actor = await ensureAdminOrVa(admin, jwt);
    }

    // ── settings ──────────────────────────────────────────────────────────
    if (action === "get_settings") {
      const settings = await loadSettings(admin);
      return json({ ok: true, settings });
    }

    if (action === "save_settings") {
      const settings = parseUrgentHireSettings(body?.settings);
      await admin.from("app_settings").upsert({
        key: URGENT_HIRE_SETTINGS_KEY,
        value: settings,
        updated_at: new Date().toISOString(),
        updated_by: actor?.id || null,
      });
      return json({ ok: true, settings });
    }

    if (action === "expire") {
      const { data, error } = await admin.rpc("expire_urgent_hire_broadcasts");
      if (error) throw error;
      const closed = Number(data?.broadcasts || 0);
      if (closed > 0) {
        const { data: unfilled } = await admin
          .from("urgent_hire_broadcasts")
          .select("id, job_id, booking_id, eligible_count, reached_count, job_snapshot, fill_deadline_at")
          .eq("status", "unfilled")
          .not("unfilled_at", "is", null)
          .gte("unfilled_at", new Date(Date.now() - 2 * 60 * 1000).toISOString());
        for (const b of unfilled || []) {
          const snap = (b.job_snapshot || {}) as Record<string, unknown>;
          await logEvent(admin, {
            type: "urgent_hire.unfilled",
            summary: `Urgent Hire did not fill ${snap.ref || b.job_id} — still needs coverage.`,
            jobId: b.job_id,
            bookingId: b.booking_id,
            data: {
              broadcast_id: b.id,
              eligible_count: b.eligible_count,
              reached_count: b.reached_count,
            },
          });
          await notifyDiscord(admin, {
            title: "Urgent Hire did not fill",
            description: `${snap.ref || "A job"} is still uncovered. ${b.reached_count} applicant(s) were reached.`,
            color: 0xb91c1c,
            fields: [
              { name: "Reached", value: String(b.reached_count), inline: true },
              { name: "Eligible", value: String(b.eligible_count), inline: true },
            ],
          });
        }
      }
      return json({ ok: true, ...(data || {}) });
    }

    if (action === "log") {
      const { data: broadcasts, error } = await admin
        .from("urgent_hire_broadcasts")
        .select(
          "id, job_id, booking_id, status, radius_miles, pay_percent, first_job_only, fill_deadline_at, eligible_count, reached_count, skipped_no_location, filled_by_cleaner_id, filled_by_applicant_id, filled_at, unfilled_at, job_snapshot, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      const ids = (broadcasts || []).map((b: { id: string }) => b.id);
      const jobIds = [
        ...new Set((broadcasts || []).map((b: { job_id: string }) => String(b.job_id)).filter(Boolean)),
      ];
      const [{ data: offers }, { data: jobs }] = await Promise.all([
        ids.length
          ? admin
            .from("urgent_hire_offers")
            .select(
              "id, broadcast_id, applicant_id, cleaner_id, applicant_name, status, distance_miles, had_valid_checklist, last_step, viewed_at, accepted_at, sms_sent_at, email_sent_at, created_at",
            )
            .in("broadcast_id", ids)
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
        jobIds.length
          ? admin.from("jobs").select("id, status").in("id", jobIds)
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      ]);
      const jobStatus = new Map(
        ((jobs || []) as { id: string; status: string | null }[]).map((j) => [j.id, j.status]),
      );
      const annotated = (broadcasts || []).map((b: { id: string; job_id: string; status: string }) => ({
        ...b,
        stillNeedsCoverage: unfilledStillNeedsCoverage({
          broadcastStatus: b.status,
          jobStatus: jobStatus.get(b.job_id) || null,
        }),
      }));
      return json({ ok: true, broadcasts: annotated, offers: offers || [] });
    }

    if (action === "preview" || action === "send") {
      const jobId = String(body?.jobId || "").trim();
      if (!jobId) return json({ ok: false, error: "jobId required" }, 400);
      const settings = parseUrgentHireSettings({
        ...(await loadSettings(admin)),
        ...(body?.radiusMiles != null ? { radius_miles: body.radiusMiles } : {}),
        ...(body?.payPercent != null ? { pay_percent: body.payPercent } : {}),
        ...(body?.fillWindowMinutes != null ? { fill_window_minutes: body.fillWindowMinutes } : {}),
      });

      const bundle = await loadJobBundle(admin, jobId);
      const jobStatus = String(bundle.job.status || "").toLowerCase();
      if (jobStatus.includes("cancel")) {
        return json({ ok: false, error: "That job is cancelled." }, 409);
      }

      const coords = await resolveJobCoords(admin, bundle);

      let { data: open } = await admin
        .from("urgent_hire_broadcasts")
        .select("id, status, reached_count, eligible_count, fill_deadline_at, created_at")
        .eq("job_id", jobId)
        .in("status", ["sending", "open"])
        .maybeSingle();

      const { eligible, unknownMileage } = await findEligible(admin, coords, settings);
      const skippedNoLocation = unknownMileage;
      const inRadiusCount = eligible.filter(
        (e) => e.distanceMiles != null && e.distanceMiles <= settings.radius_miles,
      ).length;
      const fartherCount = eligible.filter(
        (e) => e.distanceMiles != null && e.distanceMiles > settings.radius_miles,
      ).length;
      const revenue = jobValueForPay(bundle.booking || {});
      const payCents = urgentHirePayCents(revenue, settings.pay_percent);
      const { dateLabel, timeWindow } = jobWhen(bundle);
      const preview = {
        jobId,
        bookingId: bundle.booking?.id || null,
        serviceType: serviceTypeLabel(String(bundle.booking?.service_type || bundle.job.service_type || "")),
        dateLabel,
        timeWindow,
        zone: zoneLabel(
          String(bundle.booking?.city || bundle.job.city || ""),
          String(bundle.booking?.zip_code || bundle.job.zip || ""),
        ),
        jobValueCents: revenue,
        payCents,
        settings,
        eligibleCount: eligible.length,
        skippedNoLocation,
        unknownMileage,
        inRadiusCount,
        fartherCount,
        canAcceptNow: eligible.filter((e) => e.remaining.length === 0).length,
        needChecklist: eligible.filter((e) => e.remaining.includes("supplies")).length,
        openBroadcast: open || null,
        applicants: eligible.map((e) => ({
          applicantId: e.applicantId,
          name: e.name,
          stage: e.stage,
          miles: e.distanceMiles,
          hadValidChecklist: e.hadValidChecklist,
          remaining: e.remaining,
        })),
      };

      if (action === "preview") return json({ ok: true, ...preview });

      // A send that died mid-flight leaves status=sending and blocks a retry
      // via the one-open-per-job index. Treat a lock older than 2 minutes
      // with nobody reached as crashed and clear it.
      if (open && open.status === "sending") {
        const ageMs = Date.now() - new Date(open.created_at).getTime();
        if (ageMs > 2 * 60 * 1000 && Number(open.reached_count || 0) === 0) {
          await admin
            .from("urgent_hire_broadcasts")
            .update({
              status: "cancelled",
              cancelled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", open.id);
          open = null;
        }
      }

      if (open) {
        return json({
          ok: false,
          code: "already_open",
          error: "An Urgent Hire broadcast is already open for this job.",
          broadcastId: open.id,
        }, 409);
      }
      if (eligible.length === 0) {
        return json({
          ok: false,
          code: "nobody_eligible",
          error:
            "Nobody in the applicant pipeline has a valid photo ID and own vehicle, is Screening-Passed or later, and is not yet Active.",
          ...preview,
        }, 409);
      }

      const fillDeadline = new Date(Date.now() + settings.fill_window_minutes * 60 * 1000).toISOString();
      const snapshot = {
        ref: bundle.booking?.booking_number
          ? `NVC-${String(bundle.booking.booking_number).padStart(4, "0")}`
          : `Job ${String(jobId).slice(0, 8)}`,
        serviceType: preview.serviceType,
        dateLabel,
        timeWindow,
        zone: preview.zone,
        jobValueCents: revenue,
        payCents,
      };

      const { data: broadcast, error: bErr } = await admin
        .from("urgent_hire_broadcasts")
        .insert({
          job_id: jobId,
          booking_id: bundle.booking?.id || null,
          initiated_by: actor?.id || null,
          status: "sending",
          radius_miles: settings.radius_miles,
          pay_percent: settings.pay_percent,
          first_job_only: settings.first_job_only,
          fill_window_minutes: settings.fill_window_minutes,
          checklist_freshness_days: settings.checklist_freshness_days,
          fill_deadline_at: fillDeadline,
          eligible_count: eligible.length,
          skipped_no_location: skippedNoLocation,
          job_snapshot: snapshot,
        })
        .select("id")
        .single();
      if (bErr || !broadcast) throw bErr || new Error("Could not open the broadcast.");

      let reached = 0;
      for (const row of eligible) {
        try {
          const cleanerId = await ensurePendingCleaner(admin, row);
          await mintOnboardingTokens(admin, cleanerId);
          const token = mintHexToken(20);
          const { error: oErr } = await admin.from("urgent_hire_offers").insert({
            broadcast_id: broadcast.id,
            job_id: jobId,
            applicant_id: row.applicantId,
            cleaner_id: cleanerId,
            applicant_name: row.name,
            applicant_phone: row.phone,
            applicant_email: row.email,
            distance_miles: row.distanceMiles,
            had_valid_checklist: row.hadValidChecklist,
            status: "offered",
            response_token: token,
            last_step: row.remaining[0] || null,
          });
          if (oErr) {
            log("offer insert failed", oErr.message);
            continue;
          }
          const copy = offerCopyFor(
            bundle,
            settings,
            payCents,
            token,
            !row.hadValidChecklist,
            row.distanceMiles,
          );
          const comms = await sendOfferComms(admin, row, copy);
          const patch: Record<string, unknown> = { notify_error: comms.error };
          if (comms.sms) patch.sms_sent_at = new Date().toISOString();
          if (comms.email) patch.email_sent_at = new Date().toISOString();
          await admin.from("urgent_hire_offers").update(patch).eq("response_token", token);
          if (comms.sms || comms.email) reached += 1;
        } catch (err) {
          log("offer send failed", {
            applicantId: row.applicantId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await admin
        .from("urgent_hire_broadcasts")
        .update({
          status: "open",
          reached_count: reached,
          updated_at: new Date().toISOString(),
        })
        .eq("id", broadcast.id);

      await logEvent(admin, {
        type: "urgent_hire.broadcast_sent",
        summary: `Urgent Hire sent to ${reached} of ${eligible.length} eligible applicant(s) for ${snapshot.ref} (${settings.pay_percent}% first-job).`,
        jobId,
        bookingId: bundle.booking?.id ? String(bundle.booking.id) : null,
        data: {
          broadcast_id: broadcast.id,
          reached,
          eligible: eligible.length,
          skipped_no_location: skippedNoLocation,
          pay_percent: settings.pay_percent,
          radius_miles: settings.radius_miles,
          initiated_by: actor?.email,
        },
      });
      await notifyDiscord(admin, {
        title: "Urgent Hire sent",
        description: `${snapshot.ref} — ${reached} of ${eligible.length} eligible applicant(s) reached at ${settings.pay_percent}% first-job. First to finish remaining steps and accept wins.`,
        color: 0x5c0ffe,
        fields: [
          { name: "Reached", value: String(reached), inline: true },
          { name: "Zone", value: String(snapshot.zone || "—"), inline: true },
        ],
      });

      return json({
        ok: true,
        broadcastId: broadcast.id,
        reached,
        eligibleCount: eligible.length,
        skippedNoLocation,
        fillDeadlineAt: fillDeadline,
        payCents,
        settings,
      });
    }

    if (action === "cancel") {
      const broadcastId = String(body?.broadcastId || "").trim();
      if (!broadcastId) return json({ ok: false, error: "broadcastId required" }, 400);
      const { data: b } = await admin
        .from("urgent_hire_broadcasts")
        .select("id, status, job_id")
        .eq("id", broadcastId)
        .maybeSingle();
      if (!b) return json({ ok: false, error: "Broadcast not found." }, 404);
      if (!["sending", "open"].includes(String(b.status))) {
        return json({ ok: false, error: "That broadcast is already closed." }, 409);
      }
      await admin
        .from("urgent_hire_broadcasts")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", broadcastId);
      await admin
        .from("urgent_hire_offers")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("broadcast_id", broadcastId)
        .in("status", ["offered", "viewed", "progressing"]);
      return json({ ok: true });
    }

    // ── token surfaces ────────────────────────────────────────────────────
    if (action === "get" || action === "mark_viewed" || action === "accept") {
      const token = String(body?.token || "").trim();
      if (!token) return json({ ok: false, error: "token required" }, 400);

      const { data: offer } = await admin
        .from("urgent_hire_offers")
        .select(
          "id, broadcast_id, job_id, applicant_id, cleaner_id, applicant_name, status, distance_miles, had_valid_checklist, last_step, response_token, accepted_at, viewed_at",
        )
        .eq("response_token", token)
        .maybeSingle();
      if (!offer) return json({ ok: false, code: "not_found", error: "That link isn't valid." }, 404);

      const { data: broadcast } = await admin
        .from("urgent_hire_broadcasts")
        .select(
          "id, status, pay_percent, first_job_only, fill_deadline_at, checklist_freshness_days, radius_miles, job_snapshot, filled_at, filled_by_applicant_id",
        )
        .eq("id", offer.broadcast_id)
        .maybeSingle();
      if (!broadcast) return json({ ok: false, error: "Broadcast missing." }, 404);

      const settings = parseUrgentHireSettings({
        pay_percent: broadcast.pay_percent,
        first_job_only: broadcast.first_job_only,
        checklist_freshness_days: broadcast.checklist_freshness_days,
        radius_miles: broadcast.radius_miles,
      });

      const { data: cleaner } = offer.cleaner_id
        ? await admin
          .from("cleaners")
          .select(
            "id, first_name, ob_agreement_signed, ob_payouts_setup, payouts_enabled, stripe_account_id, supply_inventory, supply_checklist_submitted_at, supply_token, agreement_token, setup_token",
          )
          .eq("id", offer.cleaner_id)
          .maybeSingle()
        : { data: null };

      const checklist = supplyChecklistValid({
        inventory: (cleaner?.supply_inventory || {}) as Record<string, boolean>,
        submittedAt: cleaner?.supply_checklist_submitted_at || null,
        freshnessDays: settings.checklist_freshness_days,
      });
      const remaining = remainingUrgentHireSteps({
        checklistValid: checklist.valid,
        agreementSigned: Boolean(cleaner?.ob_agreement_signed),
        payoutsReady: payoutsReady(cleaner || {}),
      });

      const uh = `uh=${encodeURIComponent(token)}`;
      const steps = {
        supplies: cleaner?.supply_token
          ? `${URGENT_HIRE_PORTAL_BASE}/cleaner/supplies/${cleaner.supply_token}?${uh}`
          : null,
        agreement: cleaner?.agreement_token
          ? `${URGENT_HIRE_PORTAL_BASE}/cleaner/agreement/${cleaner.agreement_token}?${uh}`
          : null,
        payout: cleaner?.setup_token
          ? `${URGENT_HIRE_PORTAL_BASE}/cleaner/setup/${cleaner.setup_token}?${uh}`
          : null,
      };

      if (action === "mark_viewed" || action === "get") {
        const nextStatus =
          offer.status === "offered"
            ? remaining.length
              ? "progressing"
              : "viewed"
            : offer.status;
        const patch: Record<string, unknown> = {
          last_step: remaining[0] || null,
          had_valid_checklist: checklist.valid,
        };
        if (!offer.viewed_at) patch.viewed_at = new Date().toISOString();
        if (nextStatus !== offer.status && ["offered", "viewed", "progressing"].includes(String(offer.status))) {
          patch.status = nextStatus;
        }
        await admin.from("urgent_hire_offers").update(patch).eq("id", offer.id);
      }

      const snap = (broadcast.job_snapshot || {}) as Record<string, unknown>;
      const taken =
        ["withdrawn", "expired"].includes(String(offer.status)) ||
        ["filled", "unfilled", "cancelled"].includes(String(broadcast.status));
      const takenMessage =
        offer.status === "accepted" || broadcast.status === "filled" && offer.status === "accepted"
          ? null
          : broadcast.status === "filled"
          ? "This job is no longer available — someone else finished first. Your onboarding progress is saved."
          : broadcast.status === "unfilled" || offer.status === "expired"
          ? "This Urgent Hire window has closed. Your onboarding progress is saved — you're still in the pipeline."
          : broadcast.status === "cancelled"
          ? "This offer was cancelled. Your onboarding progress is saved."
          : offer.status === "withdrawn"
          ? "This job is no longer available — someone else finished first. Your onboarding progress is saved."
          : null;

      const payload = {
        ok: true,
        appliedAck: APPLIED_IN_PAST_ACK,
        mileageLine: formatUrgentHireMileageLine(offer.distance_miles, settings.radius_miles),
        offer: {
          id: offer.id,
          status: offer.status,
          distanceMiles: offer.distance_miles ?? null,
          acceptedAt: offer.accepted_at,
        },
        broadcast: {
          status: broadcast.status,
          fillDeadlineAt: broadcast.fill_deadline_at,
          payPercent: Number(broadcast.pay_percent),
          firstJobOnly: broadcast.first_job_only !== false,
        },
        job: {
          serviceType: snap.serviceType || "Cleaning",
          dateLabel: snap.dateLabel || "",
          timeWindow: snap.timeWindow || "",
          zone: snap.zone || "",
          payCents: Number(snap.payCents) || 0,
          firstJobNote: firstJobOnlySentence(
            broadcast.first_job_only !== false,
            Number(broadcast.pay_percent) || 45,
          ),
        },
        remaining,
        steps,
        checklist,
        taken: Boolean(taken && offer.status !== "accepted"),
        takenMessage,
        canAccept: remaining.length === 0 && !taken && offer.status !== "accepted" && broadcast.status === "open",
        backgroundCheckRequired: false,
      };

      if (action !== "accept") return json(payload);

      if (taken && offer.status !== "accepted") {
        return json({ ok: false, code: "taken", error: takenMessage, ...payload }, 409);
      }
      if (offer.status === "accepted") {
        return json({ ok: true, code: "already_yours", ...payload });
      }
      if (remaining.length > 0) {
        return json({
          ok: false,
          code: "steps_remaining",
          error: "Finish the remaining steps first, then accept. The job goes to whoever finishes and accepts soonest.",
          ...payload,
        }, 409);
      }

      const { data: claim, error: claimErr } = await admin.rpc("claim_urgent_hire_offer", {
        p_token: token,
      });
      if (claimErr) throw claimErr;
      if (!claim?.ok) {
        return json({
          ok: false,
          code: claim?.code || "taken",
          error: claim?.error || "This job is no longer available — someone else finished first. Your onboarding progress is saved.",
          taken: true,
          takenMessage: claim?.error,
        }, 409);
      }
      if (claim.code === "already_yours") {
        return json({ ok: true, code: "already_yours", ...payload });
      }

      const cleanerId = String(claim.cleanerId || offer.cleaner_id || "");
      const applicantId = String(claim.applicantId || offer.applicant_id || "");
      const bundle = await loadJobBundle(admin, String(offer.job_id));
      const bookingId = String(bundle.booking?.id || "");
      if (!bookingId || !cleanerId) {
        await admin.rpc("release_urgent_hire_claim", {
          p_offer_id: offer.id,
          p_error: "missing booking or cleaner",
        });
        return json({ ok: false, error: "We couldn't put this job on your schedule. The office has been told." }, 500);
      }

      try {
        await activateForUrgentHire(admin, cleanerId, applicantId);
      } catch (err) {
        await admin.rpc("release_urgent_hire_claim", {
          p_offer_id: offer.id,
          p_error: err instanceof Error ? err.message : "activate failed",
        });
        await revertUrgentHireActivation(admin, cleanerId, applicantId);
        throw err;
      }

      const payCents = Number(snap.payCents) || urgentHirePayCents(
        jobValueForPay(bundle.booking || {}),
        Number(broadcast.pay_percent) || 45,
      );
      const assignError = await assignWinner(admin, {
        bookingId,
        jobId: String(offer.job_id),
        cleanerId,
        cleanerName: offer.applicant_name || "Applicant",
        payCents,
        payPercent: Number(broadcast.pay_percent) || 45,
      });
      if (assignError) {
        await admin.rpc("release_urgent_hire_claim", { p_offer_id: offer.id, p_error: assignError });
        await revertUrgentHireActivation(admin, cleanerId, applicantId);
        log("assign failed after claim", { offerId: offer.id, assignError });
        return json({
          ok: false,
          error: "Something went wrong on our side putting this job on your schedule. Please don't head out until we confirm.",
        }, 500);
      }

      await logEvent(admin, {
        type: "urgent_hire.filled",
        summary: `${offer.applicant_name || "Applicant"} filled Urgent Hire for ${snap.ref || offer.job_id} at ${broadcast.pay_percent}% (first job only).`,
        jobId: String(offer.job_id),
        cleanerId,
        bookingId,
        data: {
          broadcast_id: offer.broadcast_id,
          applicant_id: applicantId,
          pay_percent: broadcast.pay_percent,
          background_check_required: false,
        },
      });
      await notifyDiscord(admin, {
        title: "Urgent Hire filled",
        description: `${offer.applicant_name || "An applicant"} took ${snap.ref || "the job"} at ${broadcast.pay_percent}% (first job only). Background check was not required.`,
        color: 0x047857,
      });

      try {
        await notifyLosers(admin, String(offer.broadcast_id), String(offer.id));
      } catch (err) {
        log("loser notify failed", err instanceof Error ? err.message : String(err));
      }

      return json({
        ok: true,
        code: "claimed",
        job: payload.job,
        portalUrl: `${URGENT_HIRE_PORTAL_BASE}/cleaner/mobile-dashboard`,
        backgroundCheckRequired: false,
      });
    }

    return json({ ok: false, error: `Unknown action: ${action || "(none)"}` }, 400);
  } catch (e) {
    const msg = urgentHireErrorMessage(e);
    log("error", msg);
    const status = /not signed in/i.test(msg) ? 401 : /admins or vas/i.test(msg) ? 403 : 500;
    return json({ ok: false, error: msg }, status);
  }
});
