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
