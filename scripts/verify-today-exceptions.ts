// npm run today:verify — rules behind the Today exceptions list.
import { buildTodayExceptions, exceptionWindow, type ExceptionJob } from "../src/lib/today-exceptions";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
};

const today = "2026-11-27";
const job = (o: Partial<ExceptionJob>): ExceptionJob => ({
  id: o.id || Math.random().toString(36).slice(2),
  booking_number: 1200,
  first_name: "Sam",
  last_name: "Lee",
  business_name: null,
  status: "confirmed",
  service_date: today,
  time_slot: "9:00 AM",
  cleaner_id: null,
  ...o,
});

const items = buildTodayExceptions(
  [
    job({ id: "staff-today", status: "confirmed", cleaner_id: null }),
    job({ id: "staffed", status: "confirmed", cleaner_id: "c1" }),
    job({ id: "staff-far", status: "confirmed", service_date: "2026-12-05" }),
    job({ id: "pay-tomorrow", status: "pending_payment", service_date: "2026-11-28" }),
    job({ id: "details", status: "pending_details", service_date: "2026-11-29" }),
    job({ id: "stale", status: "assigned", service_date: "2026-11-25", cleaner_id: "c2" }),
    job({ id: "done", status: "completed", service_date: "2026-11-25" }),
    job({ id: "cancel", status: "cancelled" }),
  ],
  today,
);

check("one item per actionable booking", items.length === 4, items.map((i) => i.key));
check("unstaffed job today comes first", items[0]?.jobId === "staff-today" && items[0].kind === "needs_staffing");
check("needs-staffing links to that job in dispatch", items[0]?.href === "/admin/operations?tab=dispatch&job=staff-today");
check("awaiting payment says it can't be staffed yet", items.find((i) => i.jobId === "pay-tomorrow")?.reason.includes("can't be staffed") === true);
check("deadline reads Tomorrow · time", items.find((i) => i.jobId === "pay-tomorrow")?.deadline === "Tomorrow · 9:00 AM");
check("past visit not closed out is flagged", items.some((i) => i.jobId === "stale" && i.kind === "not_closed"));
check("staffed, far-future, completed and cancelled are not items", !items.some((i) => ["staffed", "staff-far", "done", "cancel"].includes(i.jobId)));
check("job label uses the booking number", items[0]?.job === "NVC-1200");
check("load window covers 7 days back to 3 ahead", JSON.stringify(exceptionWindow(today)) === JSON.stringify({ from: "2026-11-20", to: "2026-11-30" }));
check("no rows → no items (empty state)", buildTodayExceptions([], today).length === 0);

console.log(failures ? `\n${failures} failed` : "\nall Today exception checks passed");
process.exit(failures ? 1 : 0);
