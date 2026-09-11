import { readFileSync } from "node:fs";
import { parseRepresentment } from "../src/lib/dispute-packet";

const shared = readFileSync("supabase/functions/_shared/dispute-packet.ts", "utf8");
const caseFile = readFileSync("supabase/functions/qc-case-file/index.ts", "utf8");
const mirror = readFileSync("supabase/functions/qc-drive-mirror/index.ts", "utf8");
const banned = [/unauthorized chargebacks constitute/i, /\$150 administrative fee/, /binding arbitration with a class-action/i, /wire fraud/i];
let failed = 0;

for (const [name, text] of [
  ["_shared/dispute-packet.ts", shared],
  ["qc-case-file/index.ts", caseFile],
  ["qc-drive-mirror/index.ts", mirror],
] as const) {
  for (const re of banned) {
    if (re.test(text)) {
      console.error(`${name} still contains banned packet language (${re})`);
      failed++;
    }
  }
}
if (!shared.includes("POLICY_REFS") || !mirror.includes("from \"../_shared/dispute-packet.ts\"")) {
  console.error("qc-drive-mirror is not using the shared bank-safe policy list");
  failed++;
}

const parsed = parseRepresentment({
  headline: "Service completed. Trash missed.",
  findings: [{ claim: "Kitchen trash not pulled", ruling: "missed", evidence: "After photo A9" }],
  remedy: "Re-clean offered and declined.",
});
if (!parsed || parsed.findings[0].ruling !== "missed") {
  console.error("parseRepresentment failed");
  failed++;
}
if (parseRepresentment({}) !== null) {
  console.error("empty representment should be null");
  failed++;
}

if (failed > 0) {
  console.error(`verify-dispute-packet: ${failed} failure(s)`);
  process.exit(1);
}
console.log("verify-dispute-packet: bank-safe policy refs and representment parser ok");
