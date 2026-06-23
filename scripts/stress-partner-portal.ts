/**
 * Partner portal load / stress harness.
 *
 * Hammers the public host-onboarding endpoint (which now also provisions the
 * Host Portal account) to validate throughput, latency, idempotency, and the
 * seamless-auth path under concurrency. DB-layer scale was validated
 * separately (5k hosts / 10k properties / 15k turnovers via the Supabase
 * planner); this exercises the full HTTP + auth-provisioning path.
 *
 * Usage:
 *   BASE_URL=https://app.novaracleaning.com \
 *   STRESS_TOTAL=500 STRESS_CONCURRENCY=25 \
 *   npm run stress:partner
 *
 * Cleanup (removes the test accounts/hosts/properties/submissions it created)
 * requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment:
 *   STRESS_CLEANUP=1 npm run stress:partner
 *
 * Every record it creates is tagged with the @stress.novaratest email marker
 * so cleanup is exact and never touches real data.
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const TOTAL = Number(process.env.STRESS_TOTAL || 200);
const CONCURRENCY = Number(process.env.STRESS_CONCURRENCY || 20);
const CLEANUP = process.env.STRESS_CLEANUP === "1";
const MARKER = "@stress.novaratest";

interface Sample { ok: boolean; ms: number; status: number; accountCreated?: boolean; accountExists?: boolean; error?: string }

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function makePayload(i: number, opts: { email?: string } = {}) {
  const email = opts.email || `stress_${Date.now()}_${i}${MARKER}`;
  return {
    fullName: `Stress Host ${i}`,
    email,
    phone: `301555${String(1000 + (i % 9000))}`,
    entityType: i % 3 === 0 ? "entity" : "individual",
    entityName: i % 3 === 0 ? `Stress LLC ${i}` : undefined,
    serviceZone: "Baltimore",
    properties: [
      { nickname: `Unit ${i}A`, address: `${i} Test St`, bedrooms: 2, bathrooms: 1.5, sqft: 950, linen: true, restock: false },
      { nickname: `Unit ${i}B`, address: `${i} Test Ave`, bedrooms: 3, bathrooms: 2 },
    ],
    consentAgreement: true,
    password: `Str3ss!${i}${Math.random().toString(36).slice(2, 8)}`,
  };
}

async function submit(payload: unknown): Promise<Sample> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE_URL}/api/host-onboarding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const ms = performance.now() - t0;
    let body: Record<string, unknown> = {};
    try { body = await res.json(); } catch { /* ignore */ }
    return {
      ok: res.ok,
      ms,
      status: res.status,
      accountCreated: body.accountCreated as boolean | undefined,
      accountExists: body.accountExists as boolean | undefined,
      error: res.ok ? undefined : String(body.error || res.statusText),
    };
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function runPool<T>(items: T[], worker: (t: T, i: number) => Promise<void>, concurrency: number) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      await worker(items[cur], cur);
    }
  });
  await Promise.all(runners);
}

async function cleanup() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("⚠️  cleanup skipped — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
    return;
  }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // Delete provisioned auth users (cascades hosts/properties via app logic is
  // not automatic, so remove children first), then submissions.
  const { data: subs } = await admin
    .from("host_onboarding_submissions")
    .select("id, user_id, host_id")
    .ilike("email", `%${MARKER}`);
  const hostIds = [...new Set((subs || []).map((s) => s.host_id).filter(Boolean))] as string[];
  const userIds = [...new Set((subs || []).map((s) => s.user_id).filter(Boolean))] as string[];

  if (hostIds.length) {
    await admin.from("turnover_requests").delete().in("host_id", hostIds);
    await admin.from("properties").delete().in("host_id", hostIds);
    await admin.from("hosts").delete().in("id", hostIds);
  }
  await admin.from("host_onboarding_submissions").delete().ilike("email", `%${MARKER}`);
  for (const uid of userIds) {
    try { await admin.auth.admin.deleteUser(uid); } catch { /* ignore */ }
  }
  console.log(`🧹 cleaned ${subs?.length || 0} submissions, ${hostIds.length} hosts, ${userIds.length} auth users`);
}

async function main() {
  if (CLEANUP) { await cleanup(); return; }

  console.log(`▶️  Stress: ${TOTAL} submissions @ concurrency ${CONCURRENCY} → ${BASE_URL}`);
  const samples: Sample[] = [];
  const indices = Array.from({ length: TOTAL }, (_, i) => i);
  const wallStart = performance.now();
  await runPool(indices, async (i) => { samples.push(await submit(makePayload(i))); }, CONCURRENCY);
  const wallMs = performance.now() - wallStart;

  // Idempotency probe: submit the same email twice.
  const dupEmail = `dup_${Date.now()}${MARKER}`;
  const first = await submit(makePayload(99999, { email: dupEmail }));
  const second = await submit(makePayload(99999, { email: dupEmail }));

  const okSamples = samples.filter((s) => s.ok);
  const latencies = okSamples.map((s) => s.ms).sort((a, b) => a - b);
  const created = okSamples.filter((s) => s.accountCreated).length;
  const existed = okSamples.filter((s) => s.accountExists).length;
  const errors = samples.filter((s) => !s.ok);

  console.log("\n── Results ──────────────────────────────");
  console.log(`Total:        ${samples.length}`);
  console.log(`Success:      ${okSamples.length} (${((okSamples.length / samples.length) * 100).toFixed(1)}%)`);
  console.log(`Errors:       ${errors.length}`);
  console.log(`Throughput:   ${(samples.length / (wallMs / 1000)).toFixed(1)} req/s (wall ${(wallMs / 1000).toFixed(1)}s)`);
  console.log(`Latency p50:  ${pct(latencies, 50).toFixed(0)}ms`);
  console.log(`Latency p95:  ${pct(latencies, 95).toFixed(0)}ms`);
  console.log(`Latency p99:  ${pct(latencies, 99).toFixed(0)}ms`);
  console.log(`Latency max:  ${(latencies[latencies.length - 1] || 0).toFixed(0)}ms`);
  console.log(`Accounts:     created=${created}, alreadyExisted=${existed}`);
  console.log(`Idempotency:  first.created=${first.accountCreated} second.exists=${second.accountExists} (expect true/true)`);

  if (errors.length) {
    const byMsg = new Map<string, number>();
    for (const e of errors) byMsg.set(e.error || "?", (byMsg.get(e.error || "?") || 0) + 1);
    console.log("\nTop errors:");
    [...byMsg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([m, c]) => console.log(`  ${c}× ${m}`));
  }

  console.log("\n💡 Run `STRESS_CLEANUP=1 npm run stress:partner` to remove test data.");
}

main().catch((e) => { console.error(e); process.exit(1); });
