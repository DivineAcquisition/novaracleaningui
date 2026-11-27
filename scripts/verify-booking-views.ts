// npm run booking-views:verify
import { jobState, matchesView, parseBookingView, paymentState, staffingState, type ViewBooking } from "../src/lib/booking-views";
let failures = 0;
const check = (n: string, ok: boolean, d?: unknown) => { if (!ok) failures++; console.log(`  ${ok ? "✓" : "✗"} ${n}${!ok && d !== undefined ? ` — ${JSON.stringify(d)}` : ""}`); };
const t = "2026-11-27";
const b = (o: Partial<ViewBooking>): ViewBooking => ({ status: "confirmed", service_date: t, cleaner_id: null, ...o });

check("unknown ?view falls back to all", parseBookingView("bogus") === "all" && parseBookingView(null) === "all");
check("Today excludes cancelled", matchesView(b({}), "today", t) && !matchesView(b({ status: "cancelled" }), "today", t));
check("Awaiting deposit: pending_payment, unpaid, not credit", matchesView(b({ status: "pending_payment" }), "awaiting_deposit", t) && !matchesView(b({ status: "pending_payment", uses_credit: true }), "awaiting_deposit", t));
check("Needs staffing: confirmed and no cleaner", matchesView(b({}), "needs_staffing", t) && !matchesView(b({ cleaner_id: "c" }), "needs_staffing", t) && !matchesView(b({ num_cleaners_assigned: 2 }), "needs_staffing", t));
check("Needs staffing ignores unpaid pending bookings", !matchesView(b({ status: "pending_payment" }), "needs_staffing", t));
check("Cleaner done · review = pending_review", matchesView(b({ status: "pending_review" }), "cleaner_done", t));
check("three separate states for an unpaid booking", jobState(b({ status: "pending_payment" })) === "Awaiting payment" && paymentState(b({ status: "pending_payment" })) === "Deposit due" && staffingState(b({ status: "pending_payment" })) === "Not yet");
check("paid, confirmed, unstaffed reads Paid / Unstaffed", paymentState(b({ payment_received_at: "x" })) === "Paid" && staffingState(b({ payment_received_at: "x" })) === "Unstaffed");
check("re-clean is No charge", paymentState(b({ is_reclean: true })) === "No charge");
console.log(failures ? `\n${failures} failed` : "\nall booking view checks passed");
process.exit(failures ? 1 : 0);
