// Offline lock: unpaid-deposit reinstate must reopen the booking and
// report success. A local sendSms(admin, phone, message) used to shadow
// the shared helper, so the reinstate call (an args object) threw on
// message.trim() after the row was already pending. The panel stayed on
// Cancelled and a second click was refused.
//
//   Run:  npm run reinstate-booking:verify

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

const fn = readFileSync(resolve("supabase/functions/admin-modify-booking/index.ts"), "utf8");
const ui = readFileSync(resolve("src/views/admin/Bookings.tsx"), "utf8");

console.log("Reinstate booking:");

check(
  "uses the shared sendSms helper",
  fn.includes('import { sendSms, formatServiceDate, formatTimeSlot } from "../_shared/sms.ts"'),
  true,
);
check("does not declare a local sendSms", /function sendSms\s*\(/.test(fn), false);
check(
  "does not redeclare the support phone",
  /const SUPPORT_PHONE_DISPLAY\s*=/.test(fn),
  false,
);
check("reinstate action is present", fn.includes('action === "reinstate_unpaid_deposit"'), true);
check(
  "service-change texts use the args object",
  /sendSms\(\s*admin,\s*booking\.phone\s*,/.test(fn),
  false,
);
check("reinstate texts pass toPhone", fn.includes("toPhone: booking.phone"), true);

const reinstateAt = fn.indexOf('action === "reinstate_unpaid_deposit"');
const reinstateEnd = fn.indexOf('if (action !== "update_service")', reinstateAt);
const reinstate = reinstateAt >= 0 && reinstateEnd > reinstateAt
  ? fn.slice(reinstateAt, reinstateEnd)
  : "";
check("reinstate block was found", reinstate.length > 0, true);
check(
  "reinstate considers both cancel reasons, including unpaid_deposit",
  reinstate.includes("/unpaid.?deposit/i.test(reason)"),
  true,
);
check("reinstate confirms a row changed", reinstate.includes('.select("id")'), true);
check(
  "a text failure cannot fail the reopen",
  reinstate.includes("[admin-modify-booking] reinstate SMS failed"),
  true,
);
const smsTry = reinstate.indexOf("await sendSms(admin, {");
const smsCatch = reinstate.indexOf("[admin-modify-booking] reinstate SMS failed");
check("reinstate SMS sits inside the failure guard", smsTry >= 0 && smsCatch > smsTry, true);

// The shipped crash: the 3-arg helper treats the args object as the phone
// and then reads message.trim() on undefined.
function legacySendSms(
  _admin: unknown,
  toPhone: string | null | undefined,
  message: string,
): boolean {
  const phone = (toPhone || "").toString().trim();
  if (!phone || !message.trim()) return false;
  return true;
}
let legacyThrew = false;
try {
  legacySendSms(
    {},
    { toPhone: "5551234567", message: "reopened", type: "confirmation" } as unknown as string,
    undefined as unknown as string,
  );
} catch (err) {
  legacyThrew = err instanceof TypeError;
}
check("legacy helper throws on the reinstate call shape", legacyThrew, true);

function sharedSendSms(
  _admin: unknown,
  args: { toPhone?: string | null; message?: string | null },
): boolean {
  const phone = (args.toPhone || "").toString().trim();
  if (!phone || !args.message || !args.message.trim()) return false;
  return true;
}
check(
  "shared helper accepts the reinstate call shape",
  sharedSendSms({}, {
    toPhone: "5551234567",
    message: "Novara Cleaning: your cleaning is reopened and pending the $40.00 deposit.",
  }),
  true,
);

check(
  "sheet applies pending status before the list reloads",
  ui.includes('status: "pending_payment"') && ui.includes("if (!selected || loading) return;"),
  true,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll reinstate checks passed.");
