// ─── VA-facing EOD API (eod.novaracleaning.com) ───────────────────────────────
//
// Two ways in, and both resolve to exactly one VA record AND one date:
//
//   token   — the per-day link we email/Discord to the VA. Most VAs have no
//             workspace login, so this is the normal path. The token carries
//             its work date, so a link holder gets that day and no other, and
//             it expires 24 hours after issue.
//   session — a signed-in Supabase user mapped to their VA record. A VA gets
//             today; an admin may act on any date.
//
// Identity and date both come from the credential, never from a body field:
// there is no vaId parameter, and a non-admin cannot name a different day. That
// is what makes "only admins send EODs for other days" an enforced property
// rather than a UI convention.
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
import {
  markTokenUsed,
  resolveEodToken,
  TOKEN_FAILURE_MESSAGE,
  type EodToken,
} from "@/lib/va-performance/eod-token";
import { getEodSettings, localDate, primePerformanceSecrets } from "@/lib/va-performance/settings";
import { resolveVaForUser, type VaRecord } from "@/lib/va-performance/vas";
import type { DateGrant } from "@/lib/va-performance/eod";
import { isAdminUser } from "@/lib/va-performance/admin-check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fail(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function readPatch(body: Record<string, unknown>): SavePatch {
  const patch = (body.patch as Record<string, unknown>) || {};
  const out: SavePatch = {};
  if (patch.metrics && typeof patch.metrics === "object") {
    out.metrics = patch.metrics as Record<string, unknown>;
  }
  if (patch.selects && typeof patch.selects === "object") {
    out.selects = patch.selects as Record<string, unknown>;
  }
  if (patch.text && typeof patch.text === "object") {
    out.text = patch.text as Record<string, unknown>;
  }
  return out;
}

export async function POST(req: Request): Promise<NextResponse> {
  await primePerformanceSecrets();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = String(body.token || "").trim();

  let va: VaRecord | null = null;
  let grant: DateGrant;
  let usedToken: EodToken | null = null;

  if (token) {
    const resolved = await resolveEodToken(token);
    if (resolved.ok !== true) return fail(TOKEN_FAILURE_MESSAGE[resolved.reason], 401);
    va = resolved.value.va;
    usedToken = resolved.value.token;
    // The link IS the date. A link holder is never an admin in this context,
    // even if they happen to hold an admin account elsewhere.
    grant = { allowedDate: usedToken.workDate, isAdmin: false };
  } else {
    let principal: { userId: string; email: string };
    try {
      principal = await requireUser(req);
    } catch (err) {
      const e = err as AdminAuthError;
      return fail(e.message, e.status || 401);
    }
    va = await resolveVaForUser(principal.userId, principal.email);
    if (!va) {
      return fail(
        "This account isn't linked to a VA record yet. Ask an admin to send you your EOD link.",
        403,
      );
    }
    const settings = await getEodSettings();
    grant = {
      allowedDate: localDate(new Date(), settings.timezone),
      isAdmin: await isAdminUser(principal.userId),
    };
  }

  // Re-checked on every request, so offboarding revokes an outstanding link
  // immediately without anyone having to rotate it.
  if (va.performanceStatus === "removed" || va.status === "offboarded") {
    return fail("This account is no longer active.", 403);
  }

  const action = String(body.action || "bootstrap");
  const workDate = body.workDate ? String(body.workDate) : undefined;

  try {
    switch (action) {
      case "bootstrap":
        {
        const result = await bootstrapEod(va, grant, workDate);
        if (usedToken) void markTokenUsed(usedToken);
        return NextResponse.json({
          ok: true,
          ...result,
          link: usedToken
            ? { workDate: usedToken.workDate, expiresAt: usedToken.expiresAt }
            : null,
        });
      }

      case "save": {
        if (!workDate) return fail("Missing workDate.", 400);
        const submission = await saveDraft(va, workDate, readPatch(body), grant);
        return NextResponse.json({ ok: true, submission });
      }

      case "submit": {
        if (!workDate) return fail("Missing workDate.", 400);
        const result = await submitEod(va, workDate, readPatch(body), grant);
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
