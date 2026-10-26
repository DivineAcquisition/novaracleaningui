// Offline checks for Apploye time matching. No network and no API key.
//
// Run: npm run apploye:verify

import {
  APPLOYE_TIME_TOOLS,
  arrivalKey,
  arrivalStatus,
  assertTimeTool,
  businessDay,
  hoursByMember,
  hoursFromTrackedSeconds,
  manualInviteUrl,
  matchArrivalPunch,
  matchMemberByEmail,
  parseMcpPayload,
  projectClockins,
  projectLiveSessions,
  projectMember,
  timesheetSecondsByMember,
  trackedSecondsByMember,
  type ApployeMember,
} from "../src/lib/apploye/attendance";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name}\n    expected ${e}\n    actual   ${a}`);
  }
}

function throws(name: string, fn: () => unknown): void {
  try {
    fn();
    failures += 1;
    console.error(`  ✗ ${name}\n    expected a throw`);
  } catch {
    console.log(`  ✓ ${name}`);
  }
}

const mason: ApployeMember = {
  id: "ad91161b-d5c5-41d1-9d7c-6364b5b86604",
  email: "mason@novaracleaning.com",
  firstName: "Mason",
  lastName: "NVC",
  timezone: "America/New_York",
};

console.log("\nMembers");
check(
  "member projection lowercases email and ignores the profile image",
  projectMember({
    user_id: mason.id,
    email: "Mason@NovaraCleaning.com",
    first_name: "Mason",
    last_name: "NVC",
    image: "https://cdn.apploye.com/secret.png",
    timezone: "America/New_York",
  }),
  mason,
);
check(
  "email match is case-insensitive",
  matchMemberByEmail([mason], " MASON@novaracleaning.com ")?.id,
  mason.id,
);
check("a different email does not match", matchMemberByEmail([mason], "other@novaracleaning.com"), null);
check(
  "invite link carries the email",
  manualInviteUrl("ada@example.com", "Ada Lovelace"),
  "https://app.apploye.com/members/invite?email=ada%40example.com&name=Ada+Lovelace",
);

console.log("\nClock-in at arrival");
const clockPayload = {
  results: [{
    user: { id: mason.id, email: mason.email, image: "https://cdn.apploye.com/secret.png" },
    attendance: [
      { date: "2026-10-06", clock_in: "2026-10-06T00:41:49-04:00", clock_out: "2026-10-06T00:42:18-04:00", duration: "0h 00m 29s", duration_seconds: 29 },
      { date: "2026-10-07", clock_in: "2026-10-07T09:00:00-04:00", clock_out: null, duration_seconds: 0 },
    ],
  }],
};
const punches = projectClockins(clockPayload);
check("clock rows keep the punch and drop the profile image", punches, [
  { date: "2026-10-06", clockIn: "2026-10-06T00:41:49-04:00", clockOut: "2026-10-06T00:42:18-04:00", durationSeconds: 29 },
  { date: "2026-10-07", clockIn: "2026-10-07T09:00:00-04:00", clockOut: null, durationSeconds: 0 },
]);
check(
  "an open punch on the arrival day wins",
  matchArrivalPunch(punches, "2026-10-07", "2026-10-07T09:05:00-04:00"),
  { clockIn: "2026-10-07T09:00:00-04:00", clockOut: null, durationSeconds: 0, open: true },
);
check(
  "a closed punch that covers the arrival is the one we keep",
  matchArrivalPunch(punches, "2026-10-06", "2026-10-06T00:42:00-04:00"),
  { clockIn: "2026-10-06T00:41:49-04:00", clockOut: "2026-10-06T00:42:18-04:00", durationSeconds: 29, open: false },
);
check("another day is not this arrival", matchArrivalPunch(punches, "2026-10-08", "2026-10-08T09:00:00-04:00"), null);
check(
  "live tracking or an open punch means they are on the clock",
  arrivalStatus({ configured: true, memberId: mason.id, live: true, punch: null }),
  "tracking",
);
check(
  "a finished punch is clocked out",
  arrivalStatus({
    configured: true,
    memberId: mason.id,
    live: false,
    punch: { clockIn: "2026-10-06T00:41:49-04:00", clockOut: "2026-10-06T00:42:18-04:00", durationSeconds: 29, open: false },
  }),
  "clocked_out",
);
check(
  "no member is unlinked, not zero hours and not a failed clock",
  arrivalStatus({ configured: true, memberId: null, live: false, punch: null }),
  "unlinked",
);
check(
  "no key is unavailable",
  arrivalStatus({ configured: false, memberId: mason.id, live: true, punch: null }),
  "unavailable",
);
check(
  "arrival keys stay stable for the same job and cleaner",
  arrivalKey({ jobId: "job-1", cleanerId: "clr-1" }),
  "job:job-1:cleaner:clr-1",
);

console.log("\nHours, and nothing else");
const totals = {
  results: [{
    user: { user_id: mason.id, email: mason.email, image: "https://cdn.apploye.com/secret.png" },
    tracked_seconds: 29,
    idle_seconds: 9000,
    active_seconds: 29,
  }],
};
check("tracked seconds are kept", [...trackedSecondsByMember(totals).entries()], [[mason.id, 29]]);
check("idle seconds are not a field we return", hoursByMember(trackedSecondsByMember(totals)).get(mason.id), hoursFromTrackedSeconds(29));
check("29 seconds is 0.01 hours", hoursFromTrackedSeconds(29), 0.01);
const sheets = {
  results: [{
    user: { user_id: mason.id },
    timesheets: [{
      start_timestamp: 1791261709,
      end_timestamp: 1791261738,
      start_time: "2026-10-06T00:41:49-04:00",
      end_time: "2026-10-06T00:42:18-04:00",
      idle_times: [{ start_timestamp: 1, end_timestamp: 99999 }],
    }],
  }],
};
check("timesheet hours use the punch, not idle_times", timesheetSecondsByMember(sheets, "2026-10-06").get(mason.id), 29);
check("a timesheet from another day is ignored", timesheetSecondsByMember(sheets, "2026-10-07").get(mason.id), undefined);

console.log("\nWho is tracking");
check(
  "a live row is a member id and a start, not a photo",
  projectLiveSessions({
    results: [{ user: { user_id: mason.id, email: mason.email, first_name: "Mason", last_name: "NVC", image: "x" }, start_time: "2026-10-06T00:41:49-04:00" }],
  }),
  [{ memberId: mason.id, email: mason.email, name: "Mason NVC", startedAt: "2026-10-06T00:41:49-04:00" }],
);
check(
  "just before midnight UTC is still the previous Eastern day",
  businessDay("2026-10-06T03:30:00Z"),
  "2026-10-05",
);

console.log("\nThe allowlist");
check("time tools do not include app or URL reports", APPLOYE_TIME_TOOLS.includes("list_app_reports" as never), false);
throws("app usage is refused", () => assertTimeTool("list_app_reports"));
throws("URL usage is refused", () => assertTimeTool("list_url_reports"));
throws("suspicious activity is refused", () => assertTimeTool("list_suspicious_activity_logs"));
check("clock-in is allowed", assertTimeTool("list_clockinouts"), undefined);

console.log("\nMCP envelopes");
check(
  "a JSON-RPC tool result unwraps to the payload",
  parseMcpPayload(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify({ count: 0, results: [] }) }] },
  })),
  { count: 0, results: [] },
);
check(
  "an SSE body uses the last data line",
  parseMcpPayload('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"ok\\":true}"}]}}\n'),
  { ok: true },
);
throws("a plain error string is a failure", () => parseMcpPayload("public_api is temporarily unreachable: ReadTimeout"));

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nApploye attendance checks passed");
