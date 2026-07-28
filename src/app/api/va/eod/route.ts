// ─── VA-facing EOD API (eod.novaracleaning.com) ───────────────────────────────
//
// Authenticated: the caller's Supabase session is verified server-side and
// mapped to their VA record. Identity is never taken from the request body, so
// a VA can only ever read or write their own day.
//
// Actions:
//   bootstrap — open/resume a day: draft + pre-filled verified metrics
//   save      — auto-save the draft (Tier 2 + Tier 3 only)
//   submit    — finalise, snapshot the verified numbers, run the comparison
//   explain   — answer a discrepancy flag
//
// Tier 1 values are never accepted from the client. They are read from
// va_verified_metrics on the server, and the catalog's sanitizer discards any
// key that isn't a Tier 2 field for the selected tasks.

import { NextResponse } from "next/server";

import { AdminAuthError, requireUser } from "@/lib/admin-auth";
import {
  bootstrapEod,
  EodError,
  explainFlag,
  saveDraft,
  submitEod,
  type SavePatch,
} from "@/lib/va-performance/eod";
import { primePerformanceSecrets } from "@/lib/va-performance/settings";
import { resolveVaForUser } from "@/lib/va-performance/vas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fail(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function readPatch(body: Record<string, unknown>): SavePatch {
  const patch = (body.patch as Record<string, unknown>) || {};
  const out: SavePatch = {};
  if (Array.isArray(patch.tasksSelected)) out.tasksSelected = patch.tasksSelected.map(String);
  if (patch.selfReported && typeof patch.selfReported === "object") {
    out.selfReported = patch.selfReported as Record<string, unknown>;
  }
  if (patch.taskNotes && typeof patch.taskNotes === "object") {
    out.taskNotes = patch.taskNotes as Record<string, unknown>;
  }
  for (const key of ["blockers", "priorities", "wins", "escalations"] as const) {
    if (patch[key] !== undefined) out[key] = String(patch[key] ?? "");
  }
  return out;
}

export async function POST(req: Request): Promise<NextResponse> {
  let principal: { userId: string; email: string };
  try {
    principal = await requireUser(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return fail(e.message, e.status || 401);
  }

  await primePerformanceSecrets();

  const va = await resolveVaForUser(principal.userId, principal.email);
  if (!va) {
    return fail(
      "This account isn't linked to a VA record yet. Ask an admin to finish provisioning your access.",
      403,
    );
  }
  if (va.performanceStatus === "removed" || va.status === "offboarded") {
    return fail("This account is no longer active.", 403);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "bootstrap");
  const workDate = body.workDate ? String(body.workDate) : undefined;

  try {
    switch (action) {
      case "bootstrap":
        return NextResponse.json({ ok: true, ...(await bootstrapEod(va, workDate)) });

      case "save": {
        if (!workDate) return fail("Missing workDate.", 400);
        const submission = await saveDraft(va, workDate, readPatch(body));
        return NextResponse.json({ ok: true, submission });
      }

      case "submit": {
        if (!workDate) return fail("Missing workDate.", 400);
        const result = await submitEod(va, workDate, readPatch(body));
        if (result.issues.length) {
          return NextResponse.json({ ok: false, issues: result.issues }, { status: 422 });
        }
        return NextResponse.json({
          ok: true,
          submission: result.submission,
          flags: result.flags,
          verified: result.verified,
        });
      }

      case "explain": {
        const flagId = String(body.flagId || "");
        if (!flagId) return fail("Missing flagId.", 400);
        const flag = await explainFlag(va, flagId, String(body.explanation || ""));
        return NextResponse.json({ ok: true, flag });
      }

      default:
        return fail(`Unsupported action: ${action}`, 400);
    }
  } catch (err) {
    if (err instanceof EodError) return fail(err.message, err.status);
    console.error("[va-eod] failed:", (err as Error).message);
    return fail("Something went wrong. Your draft is saved — try again.", 500);
  }
}
