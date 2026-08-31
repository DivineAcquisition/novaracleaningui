// ─── POST /api/partner-admin/actions ─────────────────────────────────────────
//
// The admin "things hosts can't do" (spec §5), dispatched by an `action` field.
// Admin/VA gated server-side. Every mutating action runs through the partner-admin
// data layer, which enforces the guardrails (Active-rate gate, never-delete on
// offboard, future-only rate changes) and writes a who+when audit line.
//
// On success the response echoes the refreshed host detail so the UI updates
// without a second round-trip.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError, type AdminPrincipal } from "@/lib/admin-auth";
import {
  adjustIntroWindow,
  approveHostLive,
  getHostDetail,
  logManualTurnover,
  offboardHost,
  patchHost,
  patchProperty,
  pauseHost,
  pauseProperty,
  setPropertyRates,
  type HostPatch,
  type PropertyPatch,
} from "@/lib/airtable/partner-admin";
import { invokeHostOnboardingGhl } from "@/lib/host-onboarding/ghl";
import { startHostOnboardingSession } from "@/lib/host-onboarding/admin";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ActionBody {
  action?: string;
  hostId?: string;
  propertyId?: string;
  standardTurnoverRate?: number;
  introRate?: number;
  introRateEndDate?: string;
  status?: string;
  patch?: Record<string, unknown>;
  // manual turnover
  dateCompleted?: string;
  amount?: number;
  cleanerName?: string;
  numberOfCleaners?: number;
  paymentStatus?: string;
}

async function resendGhl(
  hostId: string,
  kind: "agreement" | "payment",
): Promise<{ ok: boolean; error?: string }> {
  const host = await getHostDetail(hostId, true);
  if (!host?.email) return { ok: false, error: "Host has no email on file." };
  if (kind === "agreement") {
    const rateSummary = host.properties
      .filter((p) => (p.standardTurnoverRate ?? 0) > 0)
      .map((p) => `${p.nickname}: $${p.standardTurnoverRate}${p.introRate ? ` (intro $${p.introRate})` : ""}/turnover`)
      .join("; ");
    const res = await invokeHostOnboardingGhl("sendForSignature", {
      email: host.email,
      entityType: host.entityType,
      entityName: host.company,
      rateSummary,
    });
    return { ok: res.ok, error: res.error };
  }
  // payment-setup link re-trigger
  const res = await invokeHostOnboardingGhl("submit", {
    email: host.email,
    entityType: host.entityType,
    entityName: host.company,
    fullName: host.name,
    phone: host.phone,
  });
  return { ok: res.ok, error: res.error };
}

export async function POST(req: Request): Promise<NextResponse> {
  let principal: AdminPrincipal;
  try {
    principal = await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  let body: ActionBody;
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ctx = { adminEmail: principal.email };
  const action = body.action || "";

  try {
    let hostIdForRefresh: string | undefined = body.hostId;
    let extra: Record<string, unknown> = {};

    switch (action) {
      case "set_rates": {
        if (!body.propertyId) throw new Error("propertyId is required.");
        await setPropertyRates(
          body.propertyId,
          {
            standardTurnoverRate: Number(body.standardTurnoverRate),
            introRate: body.introRate != null ? Number(body.introRate) : undefined,
            introRateEndDate: body.introRateEndDate,
          },
          ctx,
        );
        break;
      }
      case "patch_property": {
        if (!body.propertyId) throw new Error("propertyId is required.");
        await patchProperty(body.propertyId, (body.patch || {}) as PropertyPatch, ctx);
        break;
      }
      case "set_property_status": {
        if (!body.propertyId || !body.status) throw new Error("propertyId and status are required.");
        await patchProperty(body.propertyId, { propertyStatus: body.status }, ctx);
        break;
      }
      case "pause_property": {
        if (!body.propertyId) throw new Error("propertyId is required.");
        await pauseProperty(body.propertyId, ctx);
        break;
      }
      case "adjust_intro": {
        if (!body.propertyId || !body.introRateEndDate) {
          throw new Error("propertyId and introRateEndDate are required.");
        }
        await adjustIntroWindow(body.propertyId, body.introRateEndDate, ctx);
        break;
      }
      case "patch_host": {
        if (!body.hostId) throw new Error("hostId is required.");
        await patchHost(body.hostId, (body.patch || {}) as HostPatch, ctx);
        break;
      }
      case "approve_live": {
        if (!body.hostId) throw new Error("hostId is required.");
        await approveHostLive(body.hostId, ctx);
        break;
      }
      case "pause_host": {
        if (!body.hostId) throw new Error("hostId is required.");
        await pauseHost(body.hostId, ctx);
        break;
      }
      case "offboard_host": {
        if (!body.hostId) throw new Error("hostId is required.");
        await offboardHost(body.hostId, ctx);
        break;
      }
      case "manual_turnover": {
        if (!body.hostId) throw new Error("hostId is required.");
        const recordId = await logManualTurnover(
          {
            hostRecordId: body.hostId,
            propertyRecordId: body.propertyId,
            dateCompleted: body.dateCompleted || "",
            amount: Number(body.amount),
            cleanerName: body.cleanerName,
            numberOfCleaners: body.numberOfCleaners,
            paymentStatus: body.paymentStatus,
          },
          ctx,
        );
        extra = { jobRecordId: recordId };
        break;
      }
      case "resend_agreement":
      case "send_host_onboarding": {
        if (!body.hostId) throw new Error("hostId is required.");
        const started = await startHostOnboardingSession(getAdminSupabase(), {
          hostId: body.hostId,
          actorName: principal.email,
          send: true,
        });
        if (!started.ok) throw new Error(started.message || "Could not send the onboarding link.");
        extra = { link: started.link, emailed: started.emailed, texted: started.texted };
        break;
      }
      case "resend_payment": {
        if (!body.hostId) throw new Error("hostId is required.");
        const res = await resendGhl(body.hostId, "payment");
        if (!res.ok) throw new Error(res.error || "Could not resend payment-setup link.");
        break;
      }
      default:
        return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
    }

    // Echo refreshed host detail when we know the host (property actions that
    // carry hostId included); otherwise the client refetches.
    const host = hostIdForRefresh ? await getHostDetail(hostIdForRefresh, true) : null;
    return NextResponse.json({ ok: true, host, ...extra });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[partner-admin/actions]", action, (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
