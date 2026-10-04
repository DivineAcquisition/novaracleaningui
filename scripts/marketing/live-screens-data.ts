// ─── Demo data for the live-screen cards ───────────────────────────────────
//
// The live cards show the real screens from this repo with enough going on
// to read as a working business: a dispatch board with jobs in every stage,
// a QC case file with photos and payments, a membership book with MRR.
//
// Same rules as scripts/docs/capture/demo-data.ts, which most of this builds
// on: every person, address, phone number, email and payment id is invented
// (emails end in @example.test, phones use 555-01xx, Stripe-ish ids start
// demo_), and the production database is never contacted.

import type { CaptureOverlay } from "../docs/capture/supabase-mock";
import * as demo from "../docs/capture/demo-data";
import { roomPhotoKey, roomPhotoSvg, type PhotoState, type Room } from "../docs/capture/demo-room-photos";
import { MEMBERSHIP_PRICES } from "../../src/lib/pricing";
import { VALUE_STACK } from "../../src/lib/commercial-proposal";

const { iso, ts } = demo.DEMO_DATES;
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

// ─── Photos ────────────────────────────────────────────────────────────────

const PHOTO_BASE = "https://sxdraeptzuamsgjcvfeg.supabase.co/storage/v1/object/public/cleaner-job-photos/";
const photo = (room: Room, state: PhotoState) => `${PHOTO_BASE}${roomPhotoKey(room, state)}`;
const ROOMS: Room[] = ["kitchen", "bathroom", "living", "bedroom"];

function roomPhotos(path: string) {
  const match = path.match(/demo-room-photos\/([a-z]+)-(before|after)\.svg$/);
  if (!match || !ROOMS.includes(match[1] as Room)) return null;
  return { contentType: "image/svg+xml", body: roomPhotoSvg(match[1] as Room, match[2] as PhotoState) };
}

// ─── Dispatch ──────────────────────────────────────────────────────────────

const dana = demo.cleaners[0];
const luis = demo.cleaners[1];

function assignment(
  id: string,
  cleaner: { id: string; name: string },
  status: string,
  distance: number,
  payCents: number,
  extra: Partial<Record<string, unknown>> = {},
) {
  return {
    id,
    cleaner_id: cleaner.id,
    cleaner_name: cleaner.name,
    role: "lead",
    status,
    distance_miles: distance,
    estimated_pay_cents: payCents,
    expires_at: status === "Offered" ? minutesFromNow(22) : null,
    accepted_at: status === "Accepted" ? ts(-1, 15) : null,
    declined_at: status === "Declined" ? minutesFromNow(-9) : null,
    ...extra,
  };
}

const DANA = { id: dana.id, name: "Dana Whitfield" };
const LUIS = { id: luis.id, name: "Luis Ortega" };
const KEISHA = { id: "c0000000-0000-4000-8000-000000000011", name: "Keisha Grant" };
const MARISOL = { id: "c0000000-0000-4000-8000-000000000012", name: "Marisol Vega" };

function dispatchBooking(n: number, first: string, last: string, date: string, slot: string, cents: number) {
  return {
    id: `b-live-${n}`,
    booking_number: n,
    status: "confirmed",
    service_date: date,
    time_slot: slot,
    arrival_window: slot,
    first_name: first,
    last_name: last,
    phone: "(555) 010-0144",
    total_estimate_cents: cents,
    add_ons: [],
  };
}

const dispatchJobs = [
  {
    id: "dj000000-0000-4000-8000-000000000001",
    status: "Pending Approval",
    service_type: "deep",
    sq_ft: 2350,
    bedrooms: 4,
    bathrooms: 3,
    address: "27 Quillfeather Court",
    city: "Rockville",
    state: "MD",
    zip: "20850",
    start_datetime: `${iso(2)}T13:00:00`,
    duration_est_hours: 4.5,
    min_cleaners_required: 2,
    manual_intervention_required: false,
    dispatch_alert_reason: "New confirmed booking",
    booking: dispatchBooking(10252, "Elena", "Marsh", iso(2), "1:00 PM - 2:00 PM", 39000),
    assignments: [],
    checklist: null,
    addon_requests: [],
  },
  {
    id: "dj000000-0000-4000-8000-000000000002",
    status: "Offered",
    service_type: "standard",
    sq_ft: 1850,
    bedrooms: 3,
    bathrooms: 2,
    address: "418 Larkspur Lane",
    city: "Bethesda",
    state: "MD",
    zip: "20814",
    start_datetime: `${iso(1)}T10:00:00`,
    duration_est_hours: 3,
    min_cleaners_required: 1,
    manual_intervention_required: false,
    dispatch_alert_reason: null,
    booking: dispatchBooking(10247, "Jordan", "Reyes", iso(1), "10:00 AM - 11:00 AM", 22100),
    assignments: [
      assignment("ja-l-1", DANA, "Offered", 3.2, 9061),
      assignment("ja-l-2", KEISHA, "Offered", 5.8, 7735),
      assignment("ja-l-3", LUIS, "Declined", 7.4, 7735),
    ],
    checklist: null,
    addon_requests: [],
  },
  {
    id: "dj000000-0000-4000-8000-000000000005",
    status: "Pending Approval",
    service_type: "moveInOut",
    sq_ft: 1200,
    bedrooms: 2,
    bathrooms: 2,
    address: "610 Bramblewick Row",
    city: "Arlington",
    state: "VA",
    zip: "22201",
    start_datetime: `${iso(3)}T09:00:00`,
    duration_est_hours: 5,
    min_cleaners_required: 2,
    manual_intervention_required: false,
    dispatch_alert_reason: "Offer expired — nobody claimed it in time",
    booking: dispatchBooking(10251, "Rana", "Haddad", iso(3), "9:00 AM - 10:00 AM", 38000),
    assignments: [assignment("ja-l-7", LUIS, "Expired", 6.1, 7600)],
    checklist: null,
    addon_requests: [],
  },
  {
    id: "dj000000-0000-4000-8000-000000000006",
    status: "Offered",
    service_type: "deep",
    sq_ft: 2600,
    bedrooms: 4,
    bathrooms: 3,
    address: "61 Lanternfield Terrace",
    city: "Chevy Chase",
    state: "MD",
    zip: "20815",
    start_datetime: `${iso(2)}T09:00:00`,
    duration_est_hours: 5,
    min_cleaners_required: 2,
    manual_intervention_required: false,
    dispatch_alert_reason: null,
    booking: dispatchBooking(10250, "Odette", "Laurent", iso(2), "9:00 AM - 10:00 AM", 44900),
    assignments: [
      assignment("ja-l-8", MARISOL, "Accepted", 4.4, 8980),
      assignment("ja-l-9", DANA, "Offered", 2.7, 8980),
    ],
    checklist: null,
    addon_requests: [],
  },
  {
    id: "dj000000-0000-4000-8000-000000000003",
    status: "In Progress",
    service_type: "standard",
    sq_ft: 1600,
    bedrooms: 3,
    bathrooms: 2,
    address: "9 Thistlemoor Road",
    city: "Silver Spring",
    state: "MD",
    zip: "20910",
    start_datetime: `${iso(0)}T09:00:00`,
    duration_est_hours: 3,
    min_cleaners_required: 1,
    manual_intervention_required: false,
    dispatch_alert_reason: null,
    booking: dispatchBooking(10246, "Tomas", "Iverson", iso(0), "9:00 AM - 10:00 AM", 19100),
    assignments: [assignment("ja-l-4", MARISOL, "Accepted", 2.9, 6685)],
    checklist: {
      token: "demo-checklist-live-10246",
      service_type: "standard",
      total_items: 32,
      completed_items: 19,
      progress_pct: 59,
      started_at: minutesFromNow(-82),
      completed_at: null,
      last_activity_at: minutesFromNow(-4),
      last_activity_by: "Marisol Vega",
    },
    addon_requests: [],
  },
  {
    id: "dj000000-0000-4000-8000-000000000004",
    status: "Assigned",
    service_type: "deep",
    sq_ft: 2200,
    bedrooms: 4,
    bathrooms: 2,
    address: "1140 Copperwick Drive",
    city: "Ellicott City",
    state: "MD",
    zip: "21042",
    start_datetime: `${iso(1)}T14:00:00`,
    duration_est_hours: 4.5,
    min_cleaners_required: 2,
    manual_intervention_required: false,
    dispatch_alert_reason: null,
    booking: dispatchBooking(10249, "Hannah", "Delacroix", iso(1), "2:00 PM - 3:00 PM", 33000),
    assignments: [
      assignment("ja-l-5", LUIS, "Accepted", 4.1, 6600),
      assignment("ja-l-6", KEISHA, "Accepted", 6.3, 6600),
    ],
    checklist: null,
    addon_requests: [],
  },
];

const dispatchUnassigned = [
  {
    id: "b-live-10255",
    booking_number: 10255,
    status: "confirmed",
    service_date: iso(3),
    time_slot: "9:00 AM - 10:00 AM",
    arrival_window: "9:00 AM - 10:00 AM",
    first_name: "Nina",
    last_name: "Okonkwo",
    city: "Silver Spring",
    state: "MD",
    total_estimate_cents: 25500,
  },
];

// ─── The job offer a cleaner opens from the text ──────────────────────────

export const JOB_OFFER_TOKEN = "demo-offer-nvc-10247-dana";

const jobOffer = {
  assignment: {
    id: "ja-l-1",
    status: "Offered",
    role: "lead",
    distance_miles: 3.2,
    pay_rate_hr: null,
    pay_percentage_snapshot: 41,
    estimated_pay_cents: 9061,
    crew_size_snapshot: 1,
    expires_at: minutesFromNow(22),
    accepted_at: null,
    declined_at: null,
  },
  job: {
    id: "dj000000-0000-4000-8000-000000000002",
    service_type: "standard",
    start_datetime: `${iso(1)}T10:00:00`,
    duration_est_hours: 3,
    bedrooms: 3,
    bathrooms: 2,
    sq_ft: 1850,
    address: "418 Larkspur Lane",
    city: "Bethesda",
    state: "MD",
    zip: "20814",
    notes: "Side gate code 4417. Dog (Biscuit) will be in the back bedroom.",
  },
  booking: {
    service_date: iso(1),
    time_slot: "10:00 AM - 11:00 AM",
    arrival_window: "10:00 AM - 11:00 AM",
  },
  customer: { first_name: "Jordan" },
  cleaner: { first_name: "Dana", pay_tier: "proven" },
};

// ─── Quality control ───────────────────────────────────────────────────────

const qcBase = demo.qcIssues[0];
const qcIssues = [
  {
    ...qcBase,
    id: "q0000000-0000-4000-8000-000000000051",
    issue_number: 1051,
    booking_id: "b0000000-0000-4000-8000-000000000051",
    booking_ref: "NVC-10233",
    documentation_id: "jd000000-0000-4000-8000-000000000051",
    cleaner_id: luis.id,
    cleaner_name: "Luis Ortega",
    client_name: "Priya Anand",
    client_email: "priya.anand@example.test",
    issue_type: "damage",
    severity: "high",
    status: "investigating",
    title: "Scratch on dining table reported after deep clean",
    description: "Customer sent two photos the next morning. Before photos show the table top; checking the angle against the after set.",
    reported_via: "sms",
    reclean_status: "none",
    reclean_classification: null,
    reclean_inside_window: null,
    created_at: ts(0, 13),
    updated_at: ts(0, 14),
  },
  {
    ...qcBase,
    id: "q0000000-0000-4000-8000-000000000050",
    issue_number: 1050,
    booking_id: "b0000000-0000-4000-8000-000000000050",
    booking_ref: "NVC-10236",
    documentation_id: "jd000000-0000-4000-8000-000000000050",
    cleaner_id: "c0000000-0000-4000-8000-000000000011",
    cleaner_name: "Keisha Grant",
    client_name: "Hannah Delacroix",
    client_email: "hannah.delacroix@example.test",
    issue_type: "reclean",
    severity: "medium",
    status: "awaiting_customer",
    title: "Kitchen backsplash left greasy behind the range",
    description: "Inside the 48-hour window. Re-clean offered for Thursday morning, $0 to the customer.",
    reported_via: "email",
    reclean_status: "dispatched",
    reclean_classification: "quality_miss",
    reclean_inside_window: true,
    created_at: ts(-1, 16),
    updated_at: ts(0, 11),
  },
  { ...qcBase },
  {
    ...qcBase,
    id: "q0000000-0000-4000-8000-000000000049",
    issue_number: 1042,
    booking_id: "b0000000-0000-4000-8000-000000000049",
    booking_ref: "STR-2207",
    documentation_id: "jd000000-0000-4000-8000-000000000049",
    client_type: "str",
    cleaner_id: dana.id,
    cleaner_name: "Dana Whitfield",
    client_name: "Harbor Loft (host: Owen Pratt)",
    client_email: "owen.pratt@example.test",
    issue_type: "site_finding",
    severity: "low",
    status: "resolved",
    title: "Guest left a broken lamp in the bedroom",
    description: "Found at turnover. Photographed before and after; host notified with the photos.",
    reported_via: "contractor",
    resolution_note: "Host replaced the lamp; photos attached to the turnover.",
    resolved_at: ts(-3, 18),
    resolved_by_name: "Demo Admin",
    reclean_status: "none",
    reclean_classification: null,
    reclean_inside_window: null,
    created_at: ts(-3, 15),
    updated_at: ts(-3, 18),
  },
  { ...demo.qcIssues[1] },
];

function documentation(
  id: string,
  bookingId: string,
  ref: string,
  client: string,
  type: string,
  service: string,
  day: number,
  cleaner: string,
  photos: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    booking_id: bookingId,
    client_type: type,
    source_kind: type === "str" ? "turnover" : "booking",
    booking_ref: ref,
    client_name: client,
    service_type: service,
    service_date: iso(day),
    cleaner_names: cleaner,
    before_photos: [],
    after_photos: [],
    photo_count: photos,
    checklist_progress_pct: 100,
    documented: true,
    mirror_status: "mirrored",
    mirror_attempts: 1,
    mirror_last_error: null,
    mirrored_at: ts(day, 19),
    drive_folder_url: "https://drive.example.test/demo-folder",
    drive_pdf_url: "https://drive.example.test/demo-packet.pdf",
    photos_purged_at: null,
    completed_at: ts(day, 17),
    ...extra,
  };
}

const jobDocumentation = [
  documentation("jd000000-0000-4000-8000-000000000038", "b0000000-0000-4000-8000-000000000003", "NVC-10238", "Marcus Webb", "residential", "moveInOut", -2, "Dana Whitfield", 24),
  documentation("jd000000-0000-4000-8000-000000000051", "b0000000-0000-4000-8000-000000000051", "NVC-10233", "Priya Anand", "residential", "deep", -1, "Luis Ortega", 18),
  documentation("jd000000-0000-4000-8000-000000000050", "b0000000-0000-4000-8000-000000000050", "NVC-10236", "Hannah Delacroix", "residential", "standard", -1, "Keisha Grant", 16),
  documentation("jd000000-0000-4000-8000-000000000049", "b0000000-0000-4000-8000-000000000049", "STR-2207", "Harbor Loft", "str", "turnover", -3, "Dana Whitfield", 12),
  documentation("jd000000-0000-4000-8000-000000000047", "b0000000-0000-4000-8000-000000000047", "NVC-10231", "Tomas Iverson", "residential", "standard", -4, "Marisol Vega", 16),
];

const caseFile = {
  ref: "NVC-10238",
  booking: {
    id: "b0000000-0000-4000-8000-000000000003",
    booking_number: 10238,
    service_type: "moveInOut",
    service_date: iso(-2),
    time_slot: "9:00 AM - 10:00 AM",
    address: "56 Starling Quarry Way, Frederick, MD 21702",
    status: "completed",
    membership_plan: "none",
    add_ons: ["Inside oven", "Inside fridge"],
    confirmed_at: ts(-9, 15),
    check_in_time: ts(-2, 13),
    check_out_time: ts(-2, 18),
    completed_at: ts(-2, 18),
  },
  customer: {
    first_name: "Marcus",
    last_name: "Webb",
    email: "marcus.webb@example.test",
    phone: "(555) 010-0173",
  },
  cleaners: [{ name: "Dana Whitfield", status: "Completed" }],
  agreements: [
    {
      id: "ag-live-1",
      signed_by: "Marcus Webb",
      signed_at: ts(-9, 15),
      pdf_url: "https://drive.example.test/demo-agreement.pdf",
      source: "checkout",
    },
  ],
  docuseal: [],
  payments: {
    totals: {
      total_cents: 52000,
      payment_option: "deposit",
      deposit_cents: 26000,
      payment_received_at: ts(-2, 18),
      hosted_invoice_url: null,
    },
    stripe: [
      {
        kind: "Deposit",
        payment_intent_id: "pi_demo_3Qx8LkVb2m",
        amount_cents: 26000,
        status: "succeeded",
        receipt_url: "https://pay.example.test/receipt/1",
        refunded_cents: 0,
        created: ts(-9, 15),
      },
      {
        kind: "Balance",
        payment_intent_id: "pi_demo_3Qy1TnWc7r",
        amount_cents: 26000,
        status: "succeeded",
        receipt_url: "https://pay.example.test/receipt/2",
        refunded_cents: 0,
        created: ts(-2, 18),
      },
    ],
    addon_charges: [],
    completion_hold: null,
  },
  photos: {
    before: ROOMS.map((r) => photo(r, "before")),
    after: ROOMS.map((r) => photo(r, "after")),
    purged: false,
    submitted_at: ts(-2, 18),
  },
  checklist: {
    completed_items: 41,
    total_items: 41,
    progress_pct: 100,
    completed_at: ts(-2, 18),
    last_activity_by: "Dana Whitfield",
  },
  documentation: {
    mirror_status: "mirrored",
    drive_folder_url: "https://drive.example.test/demo-folder",
    drive_pdf_url: "https://drive.example.test/demo-packet.pdf",
  },
  issues: [qcIssues[2]],
  issue_events: [],
  timeline: [
    { event_type: "booking_confirmed", occurred_at: ts(-9, 15), source: "stripe-webhook", summary: "Deposit paid, booking confirmed" },
    { event_type: "job_check_in", occurred_at: ts(-2, 13), source: "job-check-in", summary: "Dana Whitfield checked in on site" },
    { event_type: "photos_submitted", occurred_at: ts(-2, 18), source: "submit-cleaner-photos", summary: "8 before / after photos submitted" },
    { event_type: "qc_issue_opened", occurred_at: ts(-2, 21), source: "qc-issues", summary: "Customer reported spotting on the shower door" },
  ],
};

// ─── Memberships ───────────────────────────────────────────────────────────

interface MemberSeed {
  n: number;
  first: string;
  last: string;
  city: string;
  plan: "weekly" | "biweekly" | "monthly";
  size: string;
  months: number;
  cleaner: { id: string; name: string };
  lastDay: number;
  nextDay: number | null;
  credits?: number;
}

const MEMBER_SEEDS: MemberSeed[] = [
  { n: 1, first: "Priya", last: "Anand", city: "Bethesda", plan: "biweekly", size: "2001_2500", months: 14, cleaner: DANA, lastDay: -6, nextDay: 8 },
  { n: 2, first: "Jordan", last: "Reyes", city: "Columbia", plan: "biweekly", size: "1501_2000", months: 9, cleaner: DANA, lastDay: -3, nextDay: 11 },
  { n: 3, first: "Hannah", last: "Delacroix", city: "Ellicott City", plan: "weekly", size: "2001_2500", months: 7, cleaner: KEISHA, lastDay: -2, nextDay: 5 },
  { n: 4, first: "Tomas", last: "Iverson", city: "Silver Spring", plan: "monthly", size: "1501_2000", months: 11, cleaner: MARISOL, lastDay: -12, nextDay: 18 },
  { n: 5, first: "Elena", last: "Marsh", city: "Rockville", plan: "biweekly", size: "2501_3000", months: 5, cleaner: LUIS, lastDay: -5, nextDay: 9 },
  { n: 6, first: "Nina", last: "Okonkwo", city: "Silver Spring", plan: "biweekly", size: "1000_1500", months: 3, cleaner: KEISHA, lastDay: -34, nextDay: null },
  { n: 7, first: "Bradley", last: "Nwosu", city: "Frederick", plan: "monthly", size: "2001_2500", months: 4, cleaner: LUIS, lastDay: -26, nextDay: 4, credits: 1 },
  { n: 8, first: "Odette", last: "Laurent", city: "Chevy Chase", plan: "weekly", size: "2501_3000", months: 2, cleaner: DANA, lastDay: -4, nextDay: 3 },
];

const email = (first: string, last: string) => `${first}.${last}`.toLowerCase() + "@example.test";
const cleansPerMonth = (plan: MemberSeed["plan"]) => (plan === "weekly" ? 4 : plan === "biweekly" ? 2 : 1);

/** The published Glow price for this home size and cadence (src/lib/pricing.ts). */
const glowMonthly = (m: MemberSeed) => MEMBERSHIP_PRICES[m.size][m.plan];

const members = MEMBER_SEEDS.map((m) => {
  const scheduleActive = m.nextDay != null;
  return {
    id: `mem-live-${m.n}`,
    email: email(m.first, m.last),
    customer_id: `cus_demo_${m.n}`,
    subscription_id: `sub_demo_${m.n}`,
    membership_plan: m.plan,
    credits_per_month: cleansPerMonth(m.plan),
    credits_remaining: m.credits ?? 0,
    credits_used: cleansPerMonth(m.plan) - (m.credits ?? 0),
    current_period_start: iso(-24),
    current_period_end: iso(m.credits ? 5 : 6),
    period_active: true,
    monthly_price_cents: glowMonthly(m) * 100,
    home_size_id: m.size,
    sources: ["stripe", "schedule"],
    customer: { first_name: m.first, last_name: m.last, phone: "(555) 010-0190", city: m.city, state: "MD" },
    schedules: scheduleActive
      ? [
          {
            id: `rs-live-${m.n}`,
            cadence: m.plan,
            active: true,
            next_service_date: iso(m.nextDay!),
            manage_token: `demo-manage-${m.n}`,
            price_cents: Math.round((glowMonthly(m) * 100) / cleansPerMonth(m.plan)),
          },
        ]
      : [],
    last_booking: { service_date: iso(m.lastDay), status: "completed" },
    created_at: iso(-Math.round(m.months * 30.4)),
    member_since: iso(-Math.round(m.months * 30.4)),
    latest_qc: null,
  };
});

/** Completed membership cleans, so the hub's LTV and last-cleaner columns fill. */
const memberBookings = MEMBER_SEEDS.flatMap((m) => {
  const per = Math.round((glowMonthly(m) * 100) / cleansPerMonth(m.plan));
  const count = Math.max(1, Math.round(m.months * cleansPerMonth(m.plan) * 0.9));
  const step = m.plan === "weekly" ? 7 : m.plan === "biweekly" ? 14 : 30;
  const [cFirst, cLast] = m.cleaner.name.split(" ");
  return Array.from({ length: count }, (_, i) => ({
    id: `b-mem-${m.n}-${i}`,
    email: email(m.first, m.last),
    status: "completed",
    final_charge_cents: per,
    total_estimate_cents: per,
    membership_plan: m.plan,
    uses_credit: true,
    service_date: iso(m.lastDay - i * step),
    completed_at: ts(m.lastDay - i * step, 17),
    booking_number: 10100 + m.n * 10 + i,
    cleaner_id: m.cleaner.id,
    cleaners: { first_name: cFirst, last_name: cLast },
  }));
});

const recurringSchedules = MEMBER_SEEDS.filter((m) => m.nextDay != null).map((m) => ({
  id: `rs-live-${m.n}`,
  email: email(m.first, m.last),
  first_name: m.first,
  last_name: m.last,
  phone: "(555) 010-0190",
  address: "Address on file",
  city: m.city,
  state: "MD",
  zip_code: "20814",
  home_size_id: m.size,
  service_type: "standard",
  add_ons: [],
  cadence: m.plan,
  preferred_time_slot: "10:00 AM - 11:00 AM",
  preferred_cleaner_id: m.cleaner.id,
  price_cents: Math.round((glowMonthly(m) * 100) / cleansPerMonth(m.plan)),
  uses_credit: true,
  membership_plan: m.plan,
  next_service_date: iso(m.nextDay!),
  last_generated_date: iso(m.lastDay),
  active: true,
  notes: null,
  manage_token: `demo-manage-${m.n}`,
}));

export const MANAGE_TOKEN = "demo-manage-1";

const manageRecurring = {
  ok: true,
  schedule: {
    first_name: "Priya",
    cadence: "biweekly",
    service_type: "standard",
    add_ons: [],
    preferred_time_slot: "10:00 AM - 11:00 AM",
    next_service_date: iso(8),
    active: true,
    price_cents: Math.round((MEMBERSHIP_PRICES["2001_2500"].biweekly * 100) / 2),
    membership_plan: "biweekly",
    address: "Address on file",
    city: "Bethesda",
  },
  upcoming: [{ id: "b-up-1", service_date: iso(8), time_slot: "10:00 AM - 11:00 AM", status: "confirmed" }],
  preview: [iso(8), iso(22), iso(36), iso(50)],
};

// ─── Payroll ───────────────────────────────────────────────────────────────

function crew(c: { id: string; name: string }, cents: number) {
  return {
    id: c.id,
    name: c.name,
    hasContact: true,
    suggestedPayoutCents: cents,
    alreadyPaid: false,
    stripeAccountId: `acct_demo_${c.id.slice(-2)}`,
    payoutsEnabled: true,
  };
}

const payrollJobs = [
  {
    bookingId: "b-pay-1",
    bookingNumber: "NVC-10244",
    status: "completed",
    serviceType: "standard",
    serviceDate: iso(-1),
    customer: "Hannah Delacroix",
    revenueCents: 23600,
    cleanerCount: 1,
    crew: [crew(DANA, 9676)],
    existingPayout: null,
  },
  {
    bookingId: "b-pay-2",
    bookingNumber: "NVC-10240",
    status: "completed",
    serviceType: "deep",
    serviceDate: iso(-1),
    customer: "Priya Anand",
    revenueCents: 39000,
    cleanerCount: 2,
    crew: [crew(LUIS, 7800), crew(KEISHA, 7800)],
    existingPayout: null,
  },
  {
    bookingId: "b-pay-3",
    bookingNumber: "NVC-10238",
    status: "completed",
    serviceType: "moveInOut",
    serviceDate: iso(-2),
    customer: "Marcus Webb",
    revenueCents: 52000,
    cleanerCount: 1,
    crew: [crew(DANA, 21320)],
    existingPayout: { amountCents: 21320, status: "paid", pctPaid: 41 },
  },
  {
    bookingId: "b-pay-4",
    bookingNumber: "NVC-10237",
    status: "completed",
    serviceType: "standard",
    serviceDate: iso(-3),
    customer: "Tomas Iverson",
    revenueCents: 19100,
    cleanerCount: 1,
    crew: [crew(MARISOL, 6685)],
    existingPayout: null,
  },
];

function recent(id: string, name: string, day: number, revenue: number, amount: number, status: "paid" | "pending") {
  return {
    id,
    bookingId: null,
    cleanerName: name,
    serviceDate: iso(day),
    revenueCents: revenue,
    amountCents: amount,
    profitCents: revenue - amount,
    pctPaid: Math.round((amount / revenue) * 1000) / 10,
    status,
    note: null,
    createdAt: ts(day, 20),
    paidAt: status === "paid" ? ts(day + 1, 15) : null,
  };
}

const payrollSummary = {
  totals: { week: 162800, month: 618400, year: 4872600, all: 5310900 },
  revenueTotals: { week: 412500, month: 1566000, year: 12210400, all: 13304800 },
  profitTotals: { week: 249700, month: 947600, year: 7337800, all: 7993900 },
  pending: { count: 3, cents: 23296 },
  roster: [
    { cleanerId: DANA.id, cleanerName: "Dana Whitfield", week: 52600, month: 198200, year: 1534000, all: 1660400, jobs: 22 },
    { cleanerId: LUIS.id, cleanerName: "Luis Ortega", week: 38900, month: 151700, year: 1187300, all: 1290000, jobs: 19 },
    { cleanerId: KEISHA.id, cleanerName: "Keisha Grant", week: 41000, month: 146100, year: 1102800, all: 1188100, jobs: 18 },
    { cleanerId: MARISOL.id, cleanerName: "Marisol Vega", week: 30300, month: 122400, year: 1048500, all: 1172400, jobs: 16 },
  ],
  recent: [
    recent("mp-l-1", "Marisol Vega", -1, 19100, 6685, "pending"),
    recent("mp-l-2", "Keisha Grant", -1, 23600, 8260, "pending"),
    recent("mp-l-3", "Dana Whitfield", -2, 52000, 21320, "paid"),
    recent("mp-l-4", "Luis Ortega", -2, 33000, 11550, "paid"),
    recent("mp-l-5", "Dana Whitfield", -3, 22100, 9061, "paid"),
    recent("mp-l-6", "Keisha Grant", -4, 29250, 10238, "paid"),
  ],
};

// ─── Leads (booking desk lookup) ───────────────────────────────────────────

const leads = [
  { id: "7f3c2a91-5d4e-4b8a-9c21-6e0d4f8b2a17", first_name: "Rachel", last_name: "Amari", email: "rachel.amari@example.test", phone: "(555) 010-0121", zip_code: "20814", service_type: "deep", lead_score: "hot", status: "new", source: "fb_lead_ads", created_at: minutesFromNow(-6), preferred_date: iso(3), preferred_time: "morning", bedrooms: 4, bathrooms: 3, sqft: 2300, special_requests: "Two cats. Inside oven if possible." },
  { id: "b41e9d07-2c6a-4f3e-8d15-93a7c0e65b48", first_name: "Raymond", last_name: "Castillo", email: "raymond.castillo@example.test", phone: "(555) 010-0127", zip_code: "21044", service_type: "standard", lead_score: "warm", status: "contacted", source: "website", created_at: ts(-1, 15), preferred_date: null, preferred_time: null, bedrooms: 3, bathrooms: 2, sqft: 1700, special_requests: null },
  { id: "e2905c6b-8f13-4a7d-b6e4-1c58d9a3f072", first_name: "Rana", last_name: "Haddad", email: "rana.haddad@example.test", phone: "(555) 010-0133", zip_code: "22201", service_type: "moveInOut", lead_score: "hot", status: "quoted", source: "lsa", created_at: ts(-1, 12), preferred_date: null, preferred_time: null, bedrooms: 2, bathrooms: 2, sqft: 1200, special_requests: null },
];

// ─── Host portal ───────────────────────────────────────────────────────────

const hostPortal = {
  ok: true,
  host: {
    name: "Owen Pratt",
    status: "active",
    paymentOption: "pay_after",
    cardOnFile: true,
    paymentBrand: "visa",
    paymentLast4: "4242",
    canUpdatePayment: true,
  },
  properties: [
    { id: "hp-1", nickname: "Harbor Loft", address: "4B Gullhaven Wharf, Annapolis, MD", bedrooms: 2, bathrooms: 2, turnoverPrice: 145, rateEditable: false },
    { id: "hp-2", nickname: "Cedar Cottage", address: "14 Saltmarsh Bend, St. Michaels, MD", bedrooms: 3, bathrooms: 2, turnoverPrice: 175, rateEditable: false },
    { id: "hp-3", nickname: "Old Town Studio", address: "88 Tidewick Street, Alexandria, VA", bedrooms: 1, bathrooms: 1, turnoverPrice: 95, rateEditable: false },
  ],
  turnovers: [
    turnover("ht-1", "hp-1", 0, "11:00 AM", "4:00 PM", 145, "scheduled", "Crew assigned"),
    turnover("ht-2", "hp-2", 1, "10:00 AM", "3:00 PM", 175, "scheduled", "Crew assigned"),
    turnover("ht-3", "hp-3", 3, "11:00 AM", "3:00 PM", 95, "requested", "Requested"),
    { ...turnover("ht-4", "hp-1", -3, "11:00 AM", "4:00 PM", 145, "completed", "Completed"), beforePhotos: [photo("bedroom", "before"), photo("bathroom", "before")], afterPhotos: [photo("bedroom", "after"), photo("bathroom", "after")], completedAt: ts(-3, 19) },
  ],
  documents: [{ label: "Host partnership agreement", url: "https://drive.example.test/demo-host-agreement.pdf", date: iso(-60) }],
};

function turnover(id: string, propertyId: string, day: number, out: string, next: string, price: number, status: string, label: string) {
  return {
    id,
    propertyId,
    requestedDate: new Date(`${iso(day)}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    windowStart: out,
    windowEnd: next,
    price,
    status,
    statusLabel: label,
    paymentOption: "pay_after",
    beforePhotos: [] as string[],
    afterPhotos: [] as string[],
    invoiceUrl: null,
    cancelFee: status === "completed" ? null : {
      tier: "free",
      hoursOut: 48,
      feeCents: 0,
      creditCents: 0,
      feePercent: 0,
      label: "Free",
      summary: "Free to cancel or reschedule until 48 hours before checkout.",
    },
    completedAt: null as string | null,
  };
}

// ─── Commercial proposal ───────────────────────────────────────────────────

export const PROPOSAL_TOKEN = "demo-proposal-wrenfield-dental";

const proposal = {
  ok: true,
  proposal: {
    id: "pr-live-1",
    version: 2,
    recipientName: "Dr. Alana Brooks",
    proposedFrequency: "3x weekly",
    term: "annual",
    billingMethod: "invoiced",
    billingMethodLocked: false,
    invoiceCycle: "monthly",
    netTerms: "net_15",
    coverNote:
      "Thanks for walking us through both offices. Pricing below is from the measured square footage on the walkthrough, with evening service after your last patient.",
    totalPerVisitCents: 41500,
    estimatedMonthlyCents: 539500,
    expiresAt: ts(14),
    preparedBy: "Novara Commercial",
  },
  account: { business_name: "Wrenfield Dental Group", contact_name: "Dr. Alana Brooks" },
  sites: [
    {
      id: "ps-1",
      business_site_id: "bs-1",
      nickname: "Bethesda office",
      address: "40 Wrenfield Plaza, Suite 210, Bethesda, MD",
      facility_type: "medical_office",
      scope_level: "standard",
      sqft: 3200,
      crew_size: 2,
      service_window_start: "18:30",
      service_window_end: "21:30",
      frequency: "3x weekly",
      per_visit_price_cents: 24500,
      price_source: "walkthrough",
      walkthrough_id: "wt-1",
      sort_order: 0,
    },
    {
      id: "ps-2",
      business_site_id: "bs-2",
      nickname: "Rockville office",
      address: "15 Cobaltline Drive, Suite 120, Rockville, MD",
      facility_type: "medical_office",
      scope_level: "standard",
      sqft: 2100,
      crew_size: 1,
      service_window_start: "18:30",
      service_window_end: "21:00",
      frequency: "3x weekly",
      per_visit_price_cents: 17000,
      price_source: "walkthrough",
      walkthrough_id: "wt-2",
      sort_order: 1,
    },
  ],
  // What /api/proposal/[token] sends with every proposal.
  valueStack: VALUE_STACK,
};

/** Minimal completed bookings spread over the last 30 days (counts only). */
function completedLastMonth(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `b-done-${i}`,
    status: "completed",
    completed_at: ts(-((i % 29) + 1), 17),
  }));
}

// ─── Overlays ──────────────────────────────────────────────────────────────

export const OVERLAYS: Record<string, CaptureOverlay> = {
  dispatch: {
    functions: {
      "admin-list-jobs": () => ({
        jobs: dispatchJobs,
        unassignedBookings: dispatchUnassigned,
        bookingsNeedingDispatch: dispatchUnassigned,
        addonRequests: [],
        settings: { contractor_addons_enabled: true, dispatch_auto_offers_enabled: false },
      }),
    },
  },
  jobOffer: {
    functions: { "get-job-offer": () => jobOffer },
  },
  qc: {
    // The issue-rate tile divides open issues by completed jobs in the last
    // 30 days (a HEAD count on bookings), so give it a month of work.
    tables: { qc_issues: qcIssues, job_documentation: jobDocumentation, bookings: completedLastMonth(146) },
    functions: { "qc-case-file": () => ({ ok: true, case: caseFile }) },
    storage: roomPhotos,
  },
  recurring: {
    tables: {
      customer_recurring_schedules: recurringSchedules,
      bookings: memberBookings,
      qc_issues: [],
    },
    functions: { "admin-memberships": () => ({ members }) },
  },
  manageRecurring: {
    functions: { "manage-recurring-schedule": () => manageRecurring },
  },
  payroll: {
    api: {
      "/api/payroll/custom": (body: { action?: string }) => {
        if (body.action === "summary") return payrollSummary;
        if (body.action === "jobs") return { jobs: payrollJobs };
        return { ok: true };
      },
    },
  },
  leads: {
    tables: { leads, customers: [] },
    rpcs: { get_customer_credit_balance_by_email: () => ({ balance_cents: 0 }) },
  },
  /** The booking desk for a brand-new customer: no wallet credit on file. */
  desk: {
    rpcs: { get_customer_credit_balance_by_email: () => ({ balance_cents: 0 }) },
  },
  host: {
    api: {
      "/api/partner-portal/me": () => ({ ok: true, email: "owen.pratt@example.test", displayName: "Owen Pratt", kinds: ["host"] }),
      "/api/partner-portal/host": () => hostPortal,
    },
    storage: roomPhotos,
  },
  proposal: {
    api: { "/api/proposal": () => proposal },
  },
};
