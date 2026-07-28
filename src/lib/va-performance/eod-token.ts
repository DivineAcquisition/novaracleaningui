// ─── Per-day EOD link tokens ──────────────────────────────────────────────────
//
// One token per VA per day, expiring 24 hours after it was issued.
//
// The token carries the work date with it. A link holder gets that one day and
// cannot ask for another — which is what makes "only admins can send EODs for
// other days" an enforced property rather than a UI convention. Backfilling
// yesterday requires a named admin to issue a link for it, and that act is
// recorded on the row (issued_by, admin_issued).
//
// Reissuing for the same day replaces the token, so a resend revokes the
// previous link instead of leaving two live at once.

import { randomBytes } from "node:crypto";

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { getEodSettings } from "./settings";
import { getVaById, type VaRecord } from "./vas";

/** 32 bytes → 64 hex. */
function mintToken(): string {
  return randomBytes(32).toString("hex");
}

export interface EodToken {
  id: string;
  token: string;
  vaId: string;
  workDate: string;
  issuedAt: string;
  expiresAt: string;
  adminIssued: boolean;
  issuedByName: string | null;
  useCount: number;
  firstUsedAt: string | null;
  revokedAt: string | null;
}

function mapToken(row: Record<string, unknown>): EodToken {
  return {
    id: String(row.id),
    token: String(row.token),
    vaId: String(row.va_id),
    workDate: String(row.work_date),
    issuedAt: String(row.issued_at),
    expiresAt: String(row.expires_at),
    adminIssued: Boolean(row.admin_issued),
    issuedByName: (row.issued_by_name as string) ?? null,
    useCount: Number(row.use_count ?? 0),
    firstUsedAt: (row.first_used_at as string) ?? null,
    revokedAt: (row.revoked_at as string) ?? null,
  };
}

export interface IssueOptions {
  /** Named admin issuing on someone's behalf. Absent = the daily system send. */
  issuedBy?: { userId: string; email: string };
  /** True when the date isn't the VA's current day — admin-only, enforced by callers. */
  adminIssued?: boolean;
}

/**
 * Issue (or replace) the link for one VA and one day.
 * Always mints a fresh token, so the previous link for that day stops working.
 */
export async function issueEodToken(
  vaId: string,
  workDate: string,
  options: IssueOptions = {},
): Promise<EodToken> {
  const settings = await getEodSettings();
  const now = Date.now();
  const expiresAt = new Date(now + settings.linkTtlHours * 3600_000).toISOString();

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("va_eod_link_tokens")
    .upsert(
      {
        va_id: vaId,
        work_date: workDate,
        token: mintToken(),
        issued_at: new Date(now).toISOString(),
        expires_at: expiresAt,
        issued_by: options.issuedBy?.userId ?? null,
        issued_by_name: options.issuedBy?.email ?? null,
        admin_issued: Boolean(options.adminIssued),
        // A replacement link starts a fresh usage trail.
        use_count: 0,
        first_used_at: null,
        last_used_at: null,
        revoked_at: null,
      },
      { onConflict: "va_id,work_date" },
    )
    .select("*")
    .single();
  if (error) throw new Error(`Couldn't issue an EOD link: ${error.message}`);
  return mapToken(data as Record<string, unknown>);
}

export type TokenFailure = "not_found" | "expired" | "revoked";

export interface ResolvedToken {
  token: EodToken;
  va: VaRecord;
}

/**
 * Look a token up and confirm it's still live.
 *
 * Deliberately a plain equality match against a unique index — no prefix
 * matching, no fallback. Anything short enough to be guessable is rejected
 * before it reaches the database.
 */
export async function resolveEodToken(
  raw: string,
): Promise<{ ok: true; value: ResolvedToken } | { ok: false; reason: TokenFailure }> {
  const value = (raw || "").trim();
  if (value.length < 32) return { ok: false, reason: "not_found" };

  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("va_eod_link_tokens")
    .select("*")
    .eq("token", value)
    .maybeSingle();
  if (error) throw new Error(`Read EOD token failed: ${error.message}`);
  if (!data) return { ok: false, reason: "not_found" };

  const token = mapToken(data as Record<string, unknown>);
  if (token.revokedAt) return { ok: false, reason: "revoked" };
  if (Date.parse(token.expiresAt) <= Date.now()) return { ok: false, reason: "expired" };

  const va = await getVaById(token.vaId);
  if (!va) return { ok: false, reason: "not_found" };

  return { ok: true, value: { token, va } };
}

/** Record that the link was opened. Best-effort — never blocks the request. */
export async function markTokenUsed(token: EodToken): Promise<void> {
  try {
    const supabase = getAdminSupabase();
    const now = new Date().toISOString();
    await supabase
      .from("va_eod_link_tokens")
      .update({
        first_used_at: token.firstUsedAt ?? now,
        last_used_at: now,
        use_count: token.useCount + 1,
      })
      .eq("id", token.id);
  } catch {
    /* usage tracking must never fail a submission */
  }
}

export const TOKEN_FAILURE_MESSAGE: Record<TokenFailure, string> = {
  not_found: "This link isn't valid. Ask an admin to send you a fresh one.",
  expired:
    "This link has expired — EOD links are good for 24 hours. Ask an admin to send you a new one for that day.",
  revoked: "This link was replaced by a newer one. Check your most recent email.",
};

/** The live (unexpired, unrevoked) link for a VA and day, if one exists. */
export async function findLiveToken(vaId: string, workDate: string): Promise<EodToken | null> {
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("va_eod_link_tokens")
    .select("*")
    .eq("va_id", vaId)
    .eq("work_date", workDate)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return data ? mapToken(data as Record<string, unknown>) : null;
}

/** Recent links for a VA, for the admin surface. */
export async function recentTokens(vaId: string, limit = 10): Promise<EodToken[]> {
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("va_eod_link_tokens")
    .select("*")
    .eq("va_id", vaId)
    .order("work_date", { ascending: false })
    .limit(limit);
  return ((data || []) as Record<string, unknown>[]).map(mapToken);
}
