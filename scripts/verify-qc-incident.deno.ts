// Policy tests for serious-allegation QC: no Score hit, no auto reclean,
// and incident-day timelines that name gaps instead of inferring events.
import {
  countsTowardQualityScore,
  intakeCreatesRecleanRequest,
} from "../supabase/functions/_shared/reclean.ts";
import {
  buildIncidentDayTimeline,
  flattenChecklistItems,
  incidentDayBounds,
  qcStatusLabel,
  scheduledWindowStartIso,
  SERIOUS_STATUS_LABEL,
} from "../supabase/functions/_shared/qc-incident.ts";

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  ", msg);
  }
}

assert(qcStatusLabel("serious_allegation", "investigating") === SERIOUS_STATUS_LABEL,
  "serious allegation investigating displays as Open — Under Investigation");
assert(intakeCreatesRecleanRequest({ issueType: "serious_allegation", reportedVia: "admin", requestReclean: true }) === false,
  "serious allegation never auto-opens a reclean");
assert(countsTowardQualityScore({ issue_type: "serious_allegation" }) === false,
  "serious allegation does not count toward quality score");

const bounds = incidentDayBounds("2026-09-09");
assert(bounds != null, "incident day bounds parse");
const startIso = bounds!.start.toISOString();
const endIso = bounds!.end.toISOString();
assert(startIso.startsWith("2026-09-09T04:00:00") || startIso.startsWith("2026-09-09T05:00:00"),
  `ET midnight for 2026-09-09 is 04:00 or 05:00 UTC (got ${startIso})`);

const windowStart = scheduledWindowStartIso("2026-09-09", "12:00–1:00 PM");
assert(windowStart != null, "scheduled window parses");

const timeline = buildIncidentDayTimeline({
  serviceDate: "2026-09-09",
  now: new Date("2026-09-10T12:00:00Z"),
  events: [
    { at: "2026-09-09T16:10:00.000Z", source: "sms_logs", label: "photo request SMS" },
    { at: "2026-09-09T17:18:57.000Z", source: "bookings.cancelled_at", label: "cancelled" },
  ],
  absentRecords: [
    { source: "bookings.check_in_time", label: "No check-in timestamp." },
  ],
  gapMs: 15 * 60 * 1000,
});

const kinds = timeline.map((e) => e.kind);
assert(kinds.includes("gap"), "timeline includes an explicit gap");
assert(kinds.includes("absent_record"), "timeline includes absent records");
assert(kinds.includes("event"), "timeline includes recorded events");
const gap = timeline.find((e) => e.kind === "gap");
assert(gap && gap.label.includes("No record"), "gap label does not invent activity");
assert(!timeline.some((e) => /probably|likely|must have/i.test(e.label)),
  "timeline never uses inferred language");

const emptyDay = buildIncidentDayTimeline({
  serviceDate: "2026-09-09",
  now: new Date("2026-09-10T12:00:00Z"),
  events: [],
});
assert(emptyDay[0]?.kind === "gap", "a day with no timestamped records is a single honest gap");

const items = flattenChecklistItems(
  { "0:0": { done: true, at: "2026-09-09T16:00:00Z" }, "0:1": { skipped: true, skipReason: "client asked to skip" } },
  [{ title: "Kitchen", items: ["Counters", "Sink"] }],
);
assert(items[0].state === "completed" && items[1].state === "skipped" && items[1].skip_reason,
  "checklist flatten preserves complete vs skipped with reason");

void startIso;
void endIso;
void windowStart;

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  // deno-lint-ignore no-explicit-any
  const exit = (globalThis as any).Deno?.exit || ((code: number) => { (globalThis as any).process?.exit(code); });
  exit(1);
}
console.log("\nall qc-incident assertions passed");
