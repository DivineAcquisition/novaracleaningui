// ─── Browser → partner-admin API client ──────────────────────────────────────
//
// Thin fetch wrapper for the admin STR console. Attaches the caller's Supabase
// access token as a Bearer credential so the server can enforce the admin gate
// (spec §8). All reads/writes go through /api/partner-admin/*.

import { supabase } from "@/integrations/supabase/client";
import type {
  DashboardData,
  HostDetail,
  HostListItem,
} from "@/lib/airtable/partner-admin";

export type {
  DashboardData,
  HostDetail,
  HostListItem,
  PropertyView,
  TurnoverView,
  HostStats,
  HostFlags,
} from "@/lib/airtable/partner-admin";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  return data as T;
}

export interface HostsResponse {
  ok: true;
  hosts: HostListItem[];
  dashboard: DashboardData;
}

export async function fetchHosts(refresh = false): Promise<HostsResponse> {
  const res = await fetch(`/api/partner-admin/hosts${refresh ? "?refresh=1" : ""}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  return handle<HostsResponse>(res);
}

export async function fetchHostDetail(id: string, refresh = false): Promise<HostDetail> {
  const res = await fetch(`/api/partner-admin/hosts/${id}${refresh ? "?refresh=1" : ""}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  const data = await handle<{ ok: true; host: HostDetail }>(res);
  return data.host;
}

export interface ActionResponse {
  ok: true;
  host: HostDetail | null;
  jobRecordId?: string | null;
}

export async function runAction(body: Record<string, unknown>): Promise<ActionResponse> {
  const res = await fetch(`/api/partner-admin/actions`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  return handle<ActionResponse>(res);
}

export interface SyncResponse {
  ok: true;
  hostsSynced: number;
  propertiesSynced: number;
  warnings?: string[];
}

/** Backfill Supabase turnover-portal hosts/properties into the Airtable base. */
export async function syncPartners(): Promise<SyncResponse> {
  const res = await fetch(`/api/partner-admin/sync`, {
    method: "POST",
    headers: await authHeaders(),
  });
  return handle<SyncResponse>(res);
}

export interface ContractorsSyncResponse {
  ok: true;
  created: boolean;
  contractorsSynced: number;
  withPay: number;
  withAgreement: number;
  warnings?: string[];
}

/** Create + sync the Airtable Contractors table (pay, payroll, agreements). */
export async function syncContractors(): Promise<ContractorsSyncResponse> {
  const res = await fetch(`/api/partner-admin/contractors-sync`, {
    method: "POST",
    headers: await authHeaders(),
  });
  return handle<ContractorsSyncResponse>(res);
}

export interface SendCalendarLinkResponse {
  ok: true;
  smsSent: boolean;
  emailSent: boolean;
  scheduleUrl: string;
  warnings?: string[];
}

/** Text + email a host their weekly cleaning scheduler link. */
export async function sendCalendarLink(input: {
  email: string;
  name?: string;
  phone?: string;
}): Promise<SendCalendarLinkResponse> {
  const res = await fetch(`/api/partner-admin/send-calendar-link`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  return handle<SendCalendarLinkResponse>(res);
}

export interface HostOnboardingAttentionRow {
  id: string;
  host_id: string;
  host_name: string | null;
  host_email: string | null;
  current_step: string | null;
  idle_hours: number | null;
  stalled: boolean;
  pending_items: number | null;
  sent_at: string | null;
}

export async function fetchHostOnboardingAttention(): Promise<HostOnboardingAttentionRow[]> {
  const res = await fetch("/api/partner-admin/host-onboarding", {
    headers: await authHeaders(),
    cache: "no-store",
  });
  const data = await handle<{ ok: true; attention: HostOnboardingAttentionRow[] }>(res);
  return data.attention || [];
}

export async function sendHostOnboarding(hostId: string): Promise<{
  ok: boolean;
  link?: string;
  emailed?: boolean;
  texted?: boolean;
  message?: string;
}> {
  const res = await fetch("/api/partner-admin/host-onboarding", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action: "send", hostId }),
  });
  return handle(res);
}

export async function nudgeHostOnboarding(sessionId: string): Promise<{ ok: boolean; emailed?: boolean; texted?: boolean }> {
  const res = await fetch("/api/partner-admin/host-onboarding", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action: "nudge", sessionId }),
  });
  return handle(res);
}

export async function setHostPayAfter(hostId: string, enabled: boolean): Promise<{ ok: boolean }> {
  const res = await fetch("/api/partner-admin/host-onboarding", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action: "set_pay_after", hostId, enabled }),
  });
  return handle(res);
}

// ─── Property Manager portfolio ops ────────────────────────────────────────

export interface PmVolumeDiscountTier {
  min_units: number;
  percent: number;
  label?: string;
}

export interface PmVolumeDiscountConfig {
  enabled: boolean;
  tiers: PmVolumeDiscountTier[];
}

export interface PmAdminAccount {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  billing_method: string;
  invoice_cycle: string;
  net_terms: string;
  volume_discount_percent: number | null;
  volume_discount_label: string | null;
  portal_provisioned_at: string | null;
  created_at: string;
  unitCount: number;
  activeUnits: number;
  pendingReview: number;
}

export interface PmAdminUnitRate {
  service: string;
  label: string;
  standingCents: number | null;
  listCents: number | null;
}

export interface PmAdminUnit {
  id: string;
  label: string;
  unitLabel: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  zoneCode: string | null;
  rates: PmAdminUnitRate[];
  discountPercent: number;
  status: string;
  reviewReason: string | null;
  reviewMessage: string | null;
  bookable: boolean;
  rateEditable: false;
}

export interface PmReviewQueueItem extends PmAdminUnit {
  pmAccountId: string;
  company: string | null;
  flaggedNonStandard: boolean;
  createdAt: string | null;
}

export interface PmOnboardingAttentionRow {
  id: string;
  pm_account_id?: string;
  company_name?: string | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
  current_step?: string | null;
  idle_hours?: number | null;
  stalled?: boolean;
  pending_items?: number | null;
}

export interface PmAdminSnapshot {
  ok: true;
  accounts: PmAdminAccount[];
  attention: PmOnboardingAttentionRow[];
  reviewQueue: PmReviewQueueItem[];
  discounts: PmVolumeDiscountConfig;
  defaultDiscounts: PmVolumeDiscountConfig;
  units?: PmAdminUnit[];
}

async function handlePm<T extends { ok?: boolean; error?: string; message?: string }>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

export async function fetchPmAdmin(accountId?: string): Promise<PmAdminSnapshot> {
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  const res = await fetch(`/api/partner-admin/property-manager${qs}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
  return handlePm<PmAdminSnapshot>(res);
}

export async function runPmAdmin<T extends { ok?: boolean; error?: string; message?: string } = Record<string, unknown> & { ok?: boolean }>(
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("/api/partner-admin/property-manager", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  return handlePm<T>(res);
}
