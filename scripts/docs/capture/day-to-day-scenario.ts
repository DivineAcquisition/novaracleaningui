// ─── Day To Day Operations capture scenario ───────────────────────────────
//
// The training video follows ONE job from "Before you go" to "Job complete":
// Dana's Standard Clean for Jordan Reyes, today, 10–11 AM, at 418 Larkspur
// Lane (side gate code, a dog called Biscuit). Every screen in the series
// shows that same job, so a viewer never has to reconcile two customers or
// two times.
//
// The shared New Hire fixtures put that job three days out and in UTC, and
// mix in a second job for the photo screens. Rather than change what those
// shots show, this module builds an overlay (see setCaptureOverlay in
// supabase-mock.ts) with the job moved to today in Eastern time and moved
// through three states — before check-in, checked in, marked complete — as
// each shot asks. Everything is still invented; nothing reaches Supabase.

import * as demo from "./demo-data";
import { setCaptureOverlay, type CaptureOverlay } from "./supabase-mock";
import { ROOMS, roomPhotoKey, roomPhotoSvg, type PhotoState, type Room } from "./demo-room-photos";
import { SUPPLY_ITEMS, SUPPLY_READY_PERCENT, scoreSupplyInventory } from "../../../src/lib/cleaner-supplies";

export const CAPTURE_TIMEZONE = "America/New_York";

/** Where the demo room photos are served from. Not the production project. */
const PHOTO_BASE = "https://demo-capture.supabase.co/storage/v1/object/public/cleaner-job-photos/";

export const HERO = {
  checklistToken: demo.DEMO_TOKENS.checklistBeforeArrival,
  photoToken: "demo-photos-nvc-10241",
  bookingNumber: 10241,
  window: "10:00 AM - 11:00 AM",
  supplyToken: "demo-supply-token-dana-whitfield",
};

// ─── Eastern-time dates ────────────────────────────────────────────────────

/** YYYY-MM-DD for today + offsetDays, as the calendar reads in Maryland. */
export function etDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CAPTURE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** ISO instant for an Eastern wall-clock time on etDate(offsetDays). */
export function etInstant(offsetDays: number, hour: number, minute = 0): string {
  const day = etDate(offsetDays);
  const zone =
    new Intl.DateTimeFormat("en-US", { timeZone: CAPTURE_TIMEZONE, timeZoneName: "shortOffset" })
      .formatToParts(new Date(`${day}T12:00:00Z`))
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const offset = Number(zone.replace("GMT", "")) || -5;
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  return new Date(
    `${day}T${pad(hour)}:${pad(minute)}:00${offset <= 0 ? "-" : "+"}${pad(offset)}:00`,
  ).toISOString();
}

// ─── Scenario ──────────────────────────────────────────────────────────────

export type JobStage = "before" | "checked_in" | "completed";

/** How much of the Standard Clean checklist is already ticked. */
export type ChecklistPreset = "none" | "kitchen-started" | "kitchen-done" | "all";

export interface DayToDayScenario {
  stage: JobStage;
  checklist?: ChecklistPreset;
  /** The contractor has pressed "Finish checklist". */
  checklistFinished?: boolean;
  /** Which photo sets are already attached on the upload page. */
  photos?: Partial<Record<PhotoState, boolean>>;
}

const DANA_ID = "c0000000-0000-4000-8000-000000000001";
const baseBooking = (n: number) => demo.bookings.find((b) => b.booking_number === n)!;

function bookingStatus(stage: JobStage): string {
  // Marking complete sends the job to the office for review; it is not
  // "completed" until an admin finalizes the charge and payout.
  return stage === "completed" ? "pending_review" : stage === "checked_in" ? "in_progress" : "confirmed";
}

const checkInAt = () => etInstant(0, 10, 4);
const completedAt = () => etInstant(0, 12, 41);

function heroBooking(stage: JobStage) {
  return {
    ...baseBooking(HERO.bookingNumber),
    service_date: etDate(0),
    time_slot: HERO.window,
    status: bookingStatus(stage),
    check_in_time: stage === "before" ? null : checkInAt(),
    completed_at: stage === "completed" ? completedAt() : null,
    photo_upload_token: HERO.photoToken,
  };
}

/** The rest of Dana's week: one more job on Thursday, one paid last weekend. */
function laterBooking() {
  return { ...baseBooking(10246), service_date: etDate(2), time_slot: "9:00 AM - 10:00 AM", status: "confirmed", check_in_time: null };
}

function heroJob(stage: JobStage) {
  return {
    id: demo.DEMO_JOB_IDS.reyes,
    address: "418 Larkspur Lane",
    city: "Columbia",
    state: "MD",
    zip: "21044",
    service_type: "standard",
    start_datetime: etInstant(0, 10, 0),
    duration_est_hours: 3,
    check_in_time: stage === "before" ? null : checkInAt(),
    check_out_time: stage === "completed" ? completedAt() : null,
    status: stage === "completed" ? "completed" : stage === "checked_in" ? "in_progress" : "accepted",
    notes: "Repeat customer, prefers Dana.",
  };
}

function laterJob() {
  const shared = demo.jobs.find((j) => j.id === demo.DEMO_JOB_IDS.tomas)!;
  return { ...shared, start_datetime: etInstant(2, 9, 0), check_in_time: null, status: "accepted" };
}

function assignments(stage: JobStage) {
  const [reyes, tomas, marcus] = [demo.DEMO_JOB_IDS.reyes, demo.DEMO_JOB_IDS.tomas, demo.DEMO_JOB_IDS.marcus].map(
    (id) => demo.jobAssignments.find((a) => a.job_id === id)!,
  );
  // assigned_at orders both dashboard lists: upcoming ascending (today's job
  // first) and completed descending (today's job above last weekend's).
  return [
    { ...reyes, status: stage === "completed" ? "completed" : "accepted", assigned_at: etInstant(-4, 15), jobs: heroJob(stage) },
    { ...tomas, status: "accepted", assigned_at: etInstant(-1, 15), jobs: laterJob() },
    { ...marcus, assigned_at: etInstant(-10, 15) },
  ];
}

const estimate = (cents: number) => ({
  actualCents: null, baseCents: null, extrasCents: 0, paidCents: 0, pendingCents: 0,
  estimateCents: cents, displayCents: cents, isActual: false, status: null, pctPaid: null, crewSize: 1, ratePercent: 41,
});
const pending = (cents: number) => ({
  ...estimate(cents), actualCents: cents, baseCents: cents, pendingCents: cents, isActual: true, status: "pending" as const,
});

function portal(stage: JobStage) {
  const payload = demo.cleanerPortalPayload();
  const hero = heroBooking(stage);
  const jobs = payload.jobs.map((j) => {
    if (j.bookingNumber === HERO.bookingNumber) {
      return {
        ...j,
        status: hero.status,
        serviceDate: hero.service_date,
        timeSlot: hero.time_slot,
        checkInTime: hero.check_in_time,
        photoUploadToken: HERO.photoToken,
        pay: stage === "completed" ? pending(12249) : estimate(12249),
      };
    }
    if (j.bookingNumber === 10246) {
      const later = laterBooking();
      return { ...j, status: later.status, serviceDate: later.service_date, timeSlot: later.time_slot, checkInTime: null, pay: estimate(14086) };
    }
    return j;
  });
  const order = [HERO.bookingNumber, 10246, 10238];
  jobs.sort((a, b) => order.indexOf(a.bookingNumber) - order.indexOf(b.bookingNumber));
  return {
    ...payload,
    jobs,
    // 132 jobs and $174 lifetime would read as a mistake on screen; these
    // agree with the cleaners row (completed_bookings, total_earnings_cents).
    summary: {
      lifetimePaidCents: 1842000,
      pendingCents: stage === "completed" ? 12249 : 0,
      paidJobs: 131,
      lifetimeTipsCents: 2500,
    },
  };
}

// ─── Checklist ─────────────────────────────────────────────────────────────

type ChecklistState = ReturnType<typeof demo.freshChecklistState>;
let checklist: ChecklistState = demo.freshChecklistState(HERO.checklistToken);

function presetKeys(preset: ChecklistPreset, sections: ChecklistState["checklist"]["sections"]): string[] {
  const all = sections.flatMap((s, si) => s.items.map((_, ii) => `${si}:${ii}`));
  if (preset === "all") return all;
  if (preset === "kitchen-done") return [...all.filter((k) => k.startsWith("0:")), "1:0", "1:1"];
  if (preset === "kitchen-started") return ["0:0", "0:1", "0:2"];
  return [];
}

function recount(state: ChecklistState) {
  const entries = Object.values(state.checklist.items) as Array<{ done?: boolean; skipped?: boolean; skipReason?: string }>;
  const completed = entries.filter((i) => i.done || (i.skipped && i.skipReason)).length;
  state.checklist.completed_items = completed;
  state.checklist.progress_pct = Math.round((completed / state.checklist.total_items) * 100);
}

function resetChecklist(scenario: DayToDayScenario) {
  checklist = demo.freshChecklistState(HERO.checklistToken);
  checklist.booking.service_date = etDate(0);
  checklist.booking.time_slot = HERO.window;
  const at = etInstant(0, 10, 20);
  for (const key of presetKeys(scenario.checklist ?? "none", checklist.checklist.sections)) {
    (checklist.checklist.items as Record<string, unknown>)[key] = { done: true, at, by: "Dana Whitfield" };
  }
  recount(checklist);
  if (scenario.checklistFinished) (checklist.checklist as { completed_at: string | null }).completed_at = etInstant(0, 12, 36);
}

function handleChecklist(body: Record<string, any>) {
  const items = checklist.checklist.items as Record<string, unknown>;
  const key = String(body?.itemKey || "");
  switch (String(body?.action || "")) {
    case "toggle":
      if (body.done) items[key] = { done: true, at: new Date().toISOString(), by: "Dana Whitfield" };
      else delete items[key];
      break;
    case "skip":
      items[key] = { skipped: true, skipReason: String(body.reason || ""), at: new Date().toISOString(), by: "Dana Whitfield" };
      break;
    case "complete":
      (checklist.checklist as { completed_at: string | null }).completed_at = new Date().toISOString();
      break;
  }
  recount(checklist);
  return checklist;
}

// ─── Photos ────────────────────────────────────────────────────────────────

const PHOTO_ROOMS: Room[] = ROOMS;

function photoUrls(state: PhotoState): string[] {
  return PHOTO_ROOMS.map((room) => `${PHOTO_BASE}${roomPhotoKey(room, state)}`);
}

function photoForm(stage: JobStage, photos: DayToDayScenario["photos"]) {
  const hero = heroBooking(stage);
  return {
    ok: true,
    bookingId: hero.id,
    bookingNumber: hero.booking_number,
    serviceDate: hero.service_date,
    timeSlot: hero.time_slot,
    customerFirstName: hero.first_name,
    addressLine: `${hero.address}, ${hero.city}, ${hero.state} ${hero.zip_code}`,
    cleanerFirstName: "Dana",
    status: hero.status,
    // Counts of 0 keep the page on the upload form: this is the screen as it
    // looks right after the contractor adds photos, before they submit.
    beforeCount: 0,
    afterCount: 0,
    beforePhotos: photos?.before ? photoUrls("before") : [],
    afterPhotos: photos?.after ? photoUrls("after") : [],
    alreadySubmitted: false,
  };
}

function storageObject(path: string) {
  const match = path.match(/demo-room-photos\/([a-z]+)-(before|after)\.svg$/);
  if (!match || !PHOTO_ROOMS.includes(match[1] as Room)) return null;
  return { contentType: "image/svg+xml", body: roomPhotoSvg(match[1] as Room, match[2] as PhotoState) };
}

// ─── Supplies ──────────────────────────────────────────────────────────────

function supplies() {
  // Dana owns the whole job kit plus a few extras; commercial gear, no.
  const extras = new Set(["stainless_steel_cleaner", "squeegee", "step_stool", "wood_furniture_polish"]);
  const inventory = Object.fromEntries(
    SUPPLY_ITEMS.filter((i) => !i.commercialEquipment).map((i) => [i.id, i.neededForJob || extras.has(i.id)]),
  );
  return {
    ok: true,
    cleaner: { firstName: "Dana", name: "Dana Whitfield" },
    items: SUPPLY_ITEMS,
    inventory,
    score: { ...scoreSupplyInventory(inventory), requiredPercent: SUPPLY_READY_PERCENT },
    submittedAt: etInstant(-200, 11),
    expiresAt: null,
  };
}

// ─── Install ───────────────────────────────────────────────────────────────

export function installDayToDayScenario(scenario: DayToDayScenario): void {
  resetChecklist(scenario);
  const stage = scenario.stage;
  const dana = demo.cleaners.find((c) => c.id === DANA_ID)!;

  const overlay: CaptureOverlay = {
    tables: {
      bookings: demo.bookings.map((b) =>
        b.booking_number === HERO.bookingNumber ? heroBooking(stage) : b.booking_number === 10246 ? laterBooking() : b,
      ),
      jobs: [heroJob(stage), laterJob(), ...demo.jobs.filter((j) => j.id === demo.DEMO_JOB_IDS.marcus)],
      job_assignments: assignments(stage),
      cleaners: demo.cleaners.map((c) =>
        c.id === DANA_ID ? { ...dana, sms_notifications_enabled: true, max_weekly_bookings: 6 } : c,
      ),
    },
    functions: {
      "get-cleaner-portal": () => portal(stage),
      "cleaner-job-checklist": handleChecklist,
      "get-cleaner-photo-form": () => photoForm(stage, scenario.photos),
      "submit-cleaner-photos": () => ({ ok: true }),
      "job-check-in": () => ({ ok: true }),
      "cleaner-mark-complete": () => ({ ok: true, photoUploadToken: HERO.photoToken }),
      "qc-issues": (body) =>
        body?.action === "field_report" ? { ok: true, issueId: "q-demo-field-report", notified: true } : { issues: [] },
    },
    api: {
      "/api/cleaner/supplies": () => supplies(),
    },
    storage: storageObject,
  };
  setCaptureOverlay(overlay);
}

export function clearDayToDayScenario(): void {
  setCaptureOverlay(null);
}
