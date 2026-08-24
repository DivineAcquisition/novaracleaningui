"use client";

// ─── Certificates of insurance — Partnerships Hub → Compliance ─────────────
//
// The COI status of every commercial account in one list, worst first.
// Expired accounts lead because they are the most expensive thing on the
// screen: live revenue that currently cannot be serviced.
//
// Status is never edited here. It is computed by the database from the
// certificate's expiration date, so the only way to change it is to record a
// certificate with a different date — which is exactly what "upload renewal"
// does, and why the block lifts the moment it lands.
//
// An override is visibly a different thing from cover: amber, always shown
// with its reason and its own expiry, and never allowed to make an account
// read as Current.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAlarmWarningLine,
  RiCheckboxCircleFill,
  RiErrorWarningLine,
  RiFileTextLine,
  RiLoader4Line,
  RiMailSendLine,
  RiRefreshLine,
  RiSearch2Line,
  RiShieldCheckLine,
  RiShieldCrossLine,
  RiTimeLine,
  RiUploadCloud2Line,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import CompanyCoiPanel from "@/views/admin/CompanyCoiPanel";

const BUCKET = "coi-documents";

export type CoiStatus = "current" | "expiring_soon" | "expired" | "not_on_file";

interface CoiOverride {
  id: string;
  reason: string;
  expires_at: string;
  created_by_name: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by_name: string | null;
  revoked_reason: string | null;
  coi_status_at_grant: string | null;
  business_accounts?: { business_name: string } | null;
  business_account_id?: string;
}

interface CoiAccountRow {
  account_id: string;
  business_name: string;
  account_type: string;
  account_status: string;
  email: string | null;
  contact_name: string | null;
  assigned_va_email: string | null;
  agreement_signed_at: string | null;
  coi_expires_at: string | null;
  coi_effective_at: string | null;
  coi_carrier: string | null;
  coi_policy_number: string | null;
  coi_verified_by_name: string | null;
  coi_status: CoiStatus;
  days_remaining: number | null;
  active_override: CoiOverride | null;
  blocked: boolean;
  active_sites: number;
  document_count: number;
  documents_in_review: number;
  priority_rank: number;
}

interface CoiDocument {
  id: string;
  document_path: string | null;
  document_name: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  carrier: string | null;
  policy_number: string | null;
  coverage_notes: string | null;
  lifecycle: string;
  review_note: string | null;
  verified_by_name: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  signedUrl: string | null;
}

interface RecurringHold {
  id: string;
  service_date: string;
  reason: string;
  blockers: string[] | null;
  status: string;
  released_at: string | null;
  resolution_note: string | null;
}

const STATUS_META: Record<CoiStatus, { label: string; chip: string; icon: typeof RiShieldCheckLine }> = {
  expired: { label: "Expired", chip: "bg-rose-100 text-rose-700", icon: RiShieldCrossLine },
  not_on_file: { label: "Not on file", chip: "bg-rose-50 text-rose-600", icon: RiErrorWarningLine },
  expiring_soon: { label: "Expiring soon", chip: "bg-amber-100 text-amber-700", icon: RiAlarmWarningLine },
  current: { label: "Current", chip: "bg-emerald-100 text-emerald-700", icon: RiShieldCheckLine },
};

async function api(method: string, body?: unknown, query = ""): Promise<Record<string, any>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api/admin/coi${query}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) throw new Error(out?.error || `Request failed (${res.status})`);
  return out;
}

function daysLabel(row: Pick<CoiAccountRow, "coi_status" | "days_remaining">): string {
  if (row.days_remaining == null) return "no certificate on file";
  if (row.days_remaining < 0) {
    const n = Math.abs(row.days_remaining);
    return `expired ${n} day${n === 1 ? "" : "s"} ago`;
  }
  return `${row.days_remaining} day${row.days_remaining === 1 ? "" : "s"} left`;
}

export default function CoiCompliance() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CoiAccountRow[]>([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CoiAccountRow | null>(null);
  const [showOverrideLog, setShowOverrideLog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api("GET", undefined, "?view=list");
      setRows((out.accounts || []) as CoiAccountRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load COI status");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c = { expired: 0, not_on_file: 0, expiring_soon: 0, current: 0, blocked: 0, overridden: 0 };
    for (const r of rows) {
      c[r.coi_status] = (c[r.coi_status] || 0) + 1;
      if (r.blocked) c.blocked += 1;
      if (r.active_override) c.overridden += 1;
    }
    return c;
  }, [rows]);

  // Sites, not accounts, is the number that matters operationally: one blocked
  // account can take a dozen locations off the board.
  const blockedSites = useMemo(
    () => rows.filter((r) => r.blocked).reduce((sum, r) => sum + Number(r.active_sites || 0), 0),
    [rows],
  );

  const filtered = useMemo(() => rows.filter((r) => {
    if (filter === "blocked" && !r.blocked) return false;
    if (filter === "overridden" && !r.active_override) return false;
    if (filter === "review" && !r.documents_in_review) return false;
    if (!["all", "blocked", "overridden", "review"].includes(filter) && r.coi_status !== filter) return false;
    if (search && !`${r.business_name} ${r.email || ""} ${r.coi_carrier || ""}`.toLowerCase()
      .includes(search.toLowerCase())) return false;
    return true;
  }), [rows, filter, search]);

  return (
    <div className="space-y-3">
      <CompanyCoiPanel />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryTile
          label="Blocked accounts" value={counts.expired + counts.not_on_file}
          sub={blockedSites ? `${blockedSites} site${blockedSites === 1 ? "" : "s"} can't be serviced` : "no sites affected"}
          tone={counts.blocked > 0 ? "rose" : "slate"}
        />
        <SummaryTile label="Expiring soon" value={counts.expiring_soon} sub="renew before the block lands" tone={counts.expiring_soon ? "amber" : "slate"} />
        <SummaryTile label="On override" value={counts.overridden} sub="temporary exceptions in force" tone={counts.overridden ? "amber" : "slate"} />
        <SummaryTile label="Current" value={counts.current} sub="covered and clear" tone="emerald" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600">
        Status is computed from each certificate&apos;s expiration date every time it is read — there is no status field
        to set, so it cannot drift. An expired or missing certificate blocks new bookings, recurring generation, and
        dispatch for <strong>every site</strong> under that account. Uploading a certificate with a valid future expiry
        lifts the block immediately.
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearch2Line className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search account, contact, carrier…" value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            <SelectItem value="blocked">Blocked right now</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="not_on_file">Not on file</SelectItem>
            <SelectItem value="expiring_soon">Expiring soon</SelectItem>
            <SelectItem value="current">Current</SelectItem>
            <SelectItem value="overridden">On override</SelectItem>
            <SelectItem value="review">Awaiting review</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RiRefreshLine className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowOverrideLog(true)}>
          Override log
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-slate-500">
          No accounts match this filter.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const meta = STATUS_META[r.coi_status];
            const Icon = meta.icon;
            return (
              <button key={r.account_id} onClick={() => setSelected(r)}
                className={cn(
                  "w-full text-left rounded-xl border bg-white px-4 py-3 transition-all hover:shadow-sm",
                  r.blocked ? "border-rose-300 bg-rose-50/30"
                    : r.active_override ? "border-amber-300 bg-amber-50/30"
                    : r.coi_status === "expiring_soon" ? "border-amber-200"
                    : "border-slate-200 hover:border-violet-300",
                )}>
                <div className="flex flex-wrap items-center gap-2">
                  <Icon className={cn("w-4 h-4", r.blocked ? "text-rose-600" : r.coi_status === "current" ? "text-emerald-600" : "text-amber-600")} />
                  <span className="font-semibold text-slate-900">{r.business_name}</span>
                  <Badge className={cn("border-0", meta.chip)}>{meta.label}</Badge>
                  {r.blocked && (
                    <Badge className="border-0 bg-rose-600 text-white">
                      BLOCKED · {r.active_sites} site{r.active_sites === 1 ? "" : "s"}
                    </Badge>
                  )}
                  {r.active_override && (
                    <Badge className="border-0 bg-amber-500 text-white">
                      Override until {format(new Date(r.active_override.expires_at), "MMM d")}
                    </Badge>
                  )}
                  {r.documents_in_review > 0 && (
                    <Badge className="border-0 bg-violet-100 text-violet-700">
                      {r.documents_in_review} awaiting review
                    </Badge>
                  )}
                  <span className="text-xs text-slate-400 ml-auto">{daysLabel(r)}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {r.coi_expires_at ? `Expires ${format(new Date(`${r.coi_expires_at}T12:00:00`), "MMM d, yyyy")}` : "No certificate recorded"}
                  {r.coi_carrier ? ` · ${r.coi_carrier}` : ""}
                  {` · ${r.active_sites} active site${r.active_sites === 1 ? "" : "s"}`}
                  {!r.agreement_signed_at ? " · no signed agreement" : ""}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <AccountCoiSheet
          account={selected}
          onClose={() => setSelected(null)}
          reload={load}
        />
      )}
      {showOverrideLog && <OverrideLog onClose={() => setShowOverrideLog(false)} />}
    </div>
  );
}

function SummaryTile({ label, value, sub, tone }: {
  label: string; value: number; sub: string; tone: "rose" | "amber" | "emerald" | "slate";
}) {
  const tones = {
    rose: "border-rose-200 bg-rose-50/60 text-rose-900",
    amber: "border-amber-200 bg-amber-50/60 text-amber-900",
    emerald: "border-emerald-200 bg-emerald-50/60 text-emerald-900",
    slate: "border-slate-200 bg-white text-slate-800",
  };
  return (
    <div className={cn("rounded-xl border p-3", tones[tone])}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-2xl font-bold leading-tight">{value}</p>
      <p className="text-[11px] opacity-70">{sub}</p>
    </div>
  );
}

// ─── One account ───────────────────────────────────────────────────────────

function AccountCoiSheet({ account, onClose, reload }: {
  account: CoiAccountRow;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<CoiAccountRow>(account);
  const [documents, setDocuments] = useState<CoiDocument[]>([]);
  const [overrides, setOverrides] = useState<CoiOverride[]>([]);
  const [holds, setHolds] = useState<RecurringHold[]>([]);

  // Upload form
  const [file, setFile] = useState<File | null>(null);
  const [effective, setEffective] = useState("");
  const [expiration, setExpiration] = useState("");
  const [carrier, setCarrier] = useState(account.coi_carrier || "");
  const [policy, setPolicy] = useState(account.coi_policy_number || "");
  const [coverage, setCoverage] = useState("");

  // Override form
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideDays, setOverrideDays] = useState("7");

  // Renewal request
  const [renewalOpen, setRenewalOpen] = useState(false);
  const [renewalTo, setRenewalTo] = useState(account.email || "");
  const [renewalMessage, setRenewalMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const out = await api("GET", undefined, `?accountId=${account.account_id}`);
      if (out.status) setStatus(out.status as CoiAccountRow);
      setDocuments((out.documents || []) as CoiDocument[]);
      setOverrides((out.overrides || []) as CoiOverride[]);
      setHolds((out.holds || []) as RecurringHold[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load certificate history");
    }
  }, [account.account_id]);
  useEffect(() => { void refresh(); }, [refresh]);

  // Prefill the renewal ask once we know how bad it is.
  useEffect(() => {
    if (renewalMessage) return;
    const when = status.coi_expires_at
      ? format(new Date(`${status.coi_expires_at}T12:00:00`), "MMMM d, yyyy")
      : null;
    setRenewalMessage(
      `Hi ${account.contact_name || "there"},\n\n` +
      (status.coi_status === "expired"
        ? `Our records show the certificate of insurance for ${account.business_name} expired on ${when}. We can't schedule or dispatch service at your locations until a current certificate is on file.`
        : `The certificate of insurance for ${account.business_name} expires on ${when}. To keep service running without interruption, we need the renewed certificate before then.`) +
      `\n\nCould you ask your broker to send the renewed COI to this address? Please have it list Novara Cleaning as certificate holder.\n\nThanks,\nNovara Cleaning`,
    );
  }, [status, account, renewalMessage]);

  const uploadDocument = async () => {
    setBusy("upload");
    try {
      let documentPath: string | null = null;
      let documentName: string | null = null;
      let documentSize: number | null = null;
      if (file) {
        const ext = (file.name.split(".").pop() || "pdf").toLowerCase().slice(0, 8);
        const key = `${account.account_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from(BUCKET).upload(key, file, {
          cacheControl: "3600",
          contentType: file.type || "application/pdf",
          upsert: false,
        });
        if (error) throw error;
        documentPath = key;
        documentName = file.name;
        documentSize = file.size;
      }

      const out = await api("POST", {
        action: "upload_document",
        accountId: account.account_id,
        documentPath,
        documentName,
        documentSizeBytes: documentSize,
        effectiveDate: effective || null,
        expirationDate: expiration || null,
        carrier: carrier || null,
        policyNumber: policy || null,
        coverageNotes: coverage || null,
      });

      if (out.needsReview) {
        toast.warning("No expiration date given — the certificate is parked for review and the block stays in place.");
      } else if (out.unblocked) {
        toast.success(
          `Certificate recorded — the block is lifted for all of this account's sites.` +
          (out.holdsReleased ? ` ${out.holdsReleased} held recurring visit(s) released.` : ""),
        );
      } else {
        toast.success("Certificate recorded.");
      }
      setFile(null); setEffective(""); setExpiration(""); setCoverage("");
      await refresh();
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const run = async (action: string, payload: Record<string, unknown>, success: string) => {
    setBusy(action);
    try {
      const out = await api("POST", { action, accountId: account.account_id, ...payload });
      toast.success(success);
      await refresh();
      await reload();
      return out;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const meta = STATUS_META[status.coi_status];
  const heldVisits = holds.filter((h) => h.status === "held");
  const lapsedVisits = holds.filter((h) => h.status === "lapsed");
  const canUpload = Boolean(file || expiration);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <RiShieldCheckLine className="w-5 h-5 text-violet-600" /> {account.business_name}
          </SheetTitle>
          <SheetDescription>
            {account.contact_name || "No contact"} · {account.email || "no email"} ·{" "}
            {status.active_sites} active site{status.active_sites === 1 ? "" : "s"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Where this account stands, and what that costs. */}
          <div className={cn(
            "rounded-lg border-2 p-3 space-y-1.5",
            status.blocked ? "border-rose-300 bg-rose-50/60"
              : status.active_override ? "border-amber-300 bg-amber-50/60"
              : status.coi_status === "expiring_soon" ? "border-amber-200 bg-amber-50/40"
              : "border-emerald-200 bg-emerald-50/50",
          )}>
            <div className="flex items-center gap-2">
              <Badge className={cn("border-0", meta.chip)}>{meta.label}</Badge>
              <span className="text-xs text-slate-600">{daysLabel(status)}</span>
            </div>
            {status.blocked ? (
              <p className="text-sm font-semibold text-rose-800">
                Blocked — new bookings, recurring generation, and dispatch are all refused for
                {" "}{status.active_sites === 1 ? "this account's site" : `all ${status.active_sites} of this account's sites`}.
              </p>
            ) : status.active_override ? (
              <>
                <p className="text-sm font-semibold text-amber-900">
                  Running on a temporary override — not on cover.
                </p>
                <p className="text-xs text-amber-800">
                  &ldquo;{status.active_override.reason}&rdquo; — granted by {status.active_override.created_by_name || "admin"},
                  expires {format(new Date(status.active_override.expires_at), "MMM d, yyyy 'at' HH:mm")}.
                  The underlying certificate is still <strong>{meta.label.toLowerCase()}</strong>.
                </p>
                <Button size="sm" variant="outline" className="h-7 text-xs mt-1"
                  disabled={busy !== null}
                  onClick={() => void run("revoke_override", { overrideId: status.active_override!.id }, "Override revoked — the block is back in force.")}>
                  Revoke override now
                </Button>
              </>
            ) : (
              <p className="text-sm text-emerald-800">
                Cover is current — this account&apos;s sites book and dispatch normally.
              </p>
            )}
            {!status.agreement_signed_at && (
              <p className="text-xs text-rose-700">Separately: there is no signed agreement on this account, which also blocks work.</p>
            )}
          </div>

          {/* Held recurring visits — the operational cost of the block. */}
          {(heldVisits.length > 0 || lapsedVisits.length > 0) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2">
              <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <RiTimeLine className="w-3.5 h-3.5" /> Recurring visits held by this block
              </p>
              {heldVisits.map((h) => (
                <p key={h.id} className="text-xs text-amber-900">
                  <strong>{format(new Date(`${h.service_date}T12:00:00`), "EEE MMM d")}</strong> — held, not generated. {h.reason}
                </p>
              ))}
              {lapsedVisits.map((h) => (
                <p key={h.id} className="text-xs text-rose-700">
                  <strong>{format(new Date(`${h.service_date}T12:00:00`), "EEE MMM d")}</strong> — lapsed: the date passed while still blocked.
                </p>
              ))}
              {heldVisits.length > 0 && (
                <p className="text-[11px] text-amber-700">
                  These generate automatically the moment a valid certificate is recorded — no separate unblock step.
                </p>
              )}
            </div>
          )}

          {/* Record a certificate. This is the only way status changes. */}
          <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-2">
            <p className="text-xs font-bold text-violet-900 flex items-center gap-1.5">
              <RiUploadCloud2Line className="w-3.5 h-3.5" /> Record a certificate
            </p>
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-violet-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-slate-500">Effective date</Label>
                <Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className="h-8 text-xs mt-0.5" />
              </div>
              <div>
                <Label className="text-[10px] text-slate-500">Expiration date *</Label>
                <Input type="date" value={expiration} onChange={(e) => setExpiration(e.target.value)} className="h-8 text-xs mt-0.5" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} className="h-8 text-xs" />
              <Input placeholder="Policy #" value={policy} onChange={(e) => setPolicy(e.target.value)} className="h-8 text-xs font-mono" />
            </div>
            <Textarea placeholder="Coverage types and limits (recorded for reference, not enforced)"
              value={coverage} onChange={(e) => setCoverage(e.target.value)} rows={2} className="text-xs" />
            <p className="text-[10px] text-slate-500">
              A future expiration date makes this the certificate in force and lifts the block immediately. Without a
              date it is parked for review — the block stays until someone confirms when it lapses.
            </p>
            <Button size="sm" className="w-full h-8 text-xs" disabled={!canUpload || busy !== null}
              onClick={() => void uploadDocument()}>
              {busy === "upload" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RiCheckboxCircleFill className="w-3.5 h-3.5 mr-1.5" />}
              Record certificate
            </Button>
          </div>

          {/* Ask the client. */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <RiMailSendLine className="w-3.5 h-3.5 text-violet-600" /> Request a renewal
              </p>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-violet-700"
                onClick={() => setRenewalOpen((v) => !v)}>
                {renewalOpen ? "Cancel" : "Compose"}
              </Button>
            </div>
            {renewalOpen && (
              <>
                <Input value={renewalTo} onChange={(e) => setRenewalTo(e.target.value)}
                  placeholder="billing@client.com" className="h-8 text-xs" />
                <Textarea value={renewalMessage} onChange={(e) => setRenewalMessage(e.target.value)}
                  rows={8} className="text-xs" />
                <Button size="sm" className="h-8 text-xs" disabled={busy !== null || !renewalTo || !renewalMessage}
                  onClick={async () => {
                    const out = await run("request_renewal",
                      { to: renewalTo, message: renewalMessage },
                      "Renewal request sent.");
                    if (out) setRenewalOpen(false);
                  }}>
                  {busy === "request_renewal" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                  Send to {renewalTo || "contact"}
                </Button>
              </>
            )}
          </div>

          {/* The exception. Deliberately the least attractive control here. */}
          {status.blocked && (
            <div className="rounded-lg border border-amber-300 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-amber-900">Override the block (rare)</p>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-amber-800"
                  onClick={() => setOverrideOpen((v) => !v)}>
                  {overrideOpen ? "Cancel" : "Open"}
                </Button>
              </div>
              {overrideOpen && (
                <>
                  <p className="text-[11px] text-amber-800">
                    For a renewal genuinely in progress with the insurer. It expires on its own, never changes the
                    certificate&apos;s status, and is logged against this account.
                  </p>
                  <Textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
                    rows={2} className="text-xs"
                    placeholder="What is being waited on, and on whose word? e.g. Renewal bound with Chubb, certificate issuing Monday — confirmed by broker email." />
                  <div className="flex items-center gap-2">
                    <div className="w-28">
                      <Label className="text-[10px] text-slate-500">Valid for (days)</Label>
                      <Input type="number" min={1} max={30} value={overrideDays}
                        onChange={(e) => setOverrideDays(e.target.value)} className="h-8 text-xs mt-0.5" />
                    </div>
                    <Button size="sm" className="h-8 text-xs mt-4 bg-amber-600 hover:bg-amber-700"
                      disabled={busy !== null || overrideReason.trim().length < 10}
                      onClick={async () => {
                        const out = await run("create_override",
                          { reason: overrideReason, days: Number(overrideDays) || 7 },
                          "Override granted and logged.");
                        if (out) { setOverrideOpen(false); setOverrideReason(""); }
                      }}>
                      {busy === "create_override" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                      Grant override
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* History — every certificate ever received, none overwritten. */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <RiFileTextLine className="w-3.5 h-3.5 text-violet-600" /> Certificate history ({documents.length})
            </p>
            {documents.length === 0 && <p className="text-xs text-slate-500">No certificates recorded yet.</p>}
            {documents.map((d) => (
              <div key={d.id} className={cn(
                "rounded-md border px-2.5 py-2 text-xs",
                d.lifecycle === "current" ? "border-emerald-200 bg-emerald-50/50"
                  : d.lifecycle === "needs_review" ? "border-violet-200 bg-violet-50/50"
                  : d.lifecycle === "rejected" ? "border-rose-200 bg-rose-50/40 opacity-70"
                  : "border-slate-200 opacity-80",
              )}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] capitalize">{d.lifecycle.replace("_", " ")}</Badge>
                  <span className="font-semibold text-slate-800">
                    {d.expiration_date
                      ? `Expires ${format(new Date(`${d.expiration_date}T12:00:00`), "MMM d, yyyy")}`
                      : "No expiry recorded"}
                  </span>
                  {d.carrier && <span className="text-slate-500">· {d.carrier}</span>}
                  {d.signedUrl && (
                    <a href={d.signedUrl} target="_blank" rel="noreferrer"
                      className="ml-auto font-semibold text-violet-700 hover:underline">
                      Open document
                    </a>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Recorded {format(new Date(d.created_at), "MMM d, yyyy")}
                  {d.uploaded_by_name ? ` by ${d.uploaded_by_name}` : ""}
                  {d.verified_by_name ? ` · verified by ${d.verified_by_name}` : ""}
                </p>
                {d.review_note && <p className="text-[11px] text-violet-700 mt-0.5">{d.review_note}</p>}
                {d.lifecycle === "needs_review" && (
                  <ReviewControls
                    busy={busy !== null}
                    onAccept={(expirationDate, effectiveDate) => void run("review_document",
                      { documentId: d.id, decision: "accept", expirationDate, effectiveDate },
                      "Certificate accepted — status recomputed from its expiry date.")}
                    onReject={() => void run("review_document",
                      { documentId: d.id, decision: "reject" }, "Certificate rejected.")}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Every exception ever granted on this account. */}
          {overrides.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
              <p className="text-xs font-bold text-slate-800">Override history ({overrides.length})</p>
              {overrides.length > 2 && (
                <p className="text-[11px] text-amber-700">
                  {overrides.length} overrides on this account — a pattern, not a one-off. Worth resolving the
                  underlying paperwork rather than renewing the exception.
                </p>
              )}
              {overrides.map((o) => {
                const active = !o.revoked_at && Date.parse(o.expires_at) > Date.now();
                return (
                  <p key={o.id} className={cn("text-[11px]", active ? "text-amber-800 font-medium" : "text-slate-500")}>
                    {format(new Date(o.created_at), "MMM d, yyyy")} · {o.created_by_name || "admin"} ·{" "}
                    {active ? `active until ${format(new Date(o.expires_at), "MMM d")}`
                      : o.revoked_at ? `revoked ${format(new Date(o.revoked_at), "MMM d")}`
                      : `expired ${format(new Date(o.expires_at), "MMM d")}`}
                    {" — "}{o.reason}
                  </p>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReviewControls({ busy, onAccept, onReject }: {
  busy: boolean;
  onAccept: (expirationDate: string, effectiveDate: string) => void;
  onReject: () => void;
}) {
  const [expiration, setExpiration] = useState("");
  const [effective, setEffective] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-violet-200 pt-2">
      <div>
        <Label className="text-[10px] text-slate-500">Effective</Label>
        <Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className="h-7 text-[11px] mt-0.5 w-36" />
      </div>
      <div>
        <Label className="text-[10px] text-slate-500">Expiration *</Label>
        <Input type="date" value={expiration} onChange={(e) => setExpiration(e.target.value)} className="h-7 text-[11px] mt-0.5 w-36" />
      </div>
      <Button size="sm" className="h-7 text-[11px]" disabled={busy || !expiration}
        onClick={() => onAccept(expiration, effective)}>
        Accept as current
      </Button>
      <Button size="sm" variant="ghost" className="h-7 text-[11px] text-rose-600" disabled={busy} onClick={onReject}>
        Reject
      </Button>
    </div>
  );
}

// ─── Override report ───────────────────────────────────────────────────────

function OverrideLog({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState<CoiOverride[]>([]);
  const [repeated, setRepeated] = useState<Array<{ accountId: string; name: string; total: number; active: number }>>([]);

  useEffect(() => {
    void (async () => {
      try {
        const out = await api("GET", undefined, "?view=overrides");
        setOverrides((out.overrides || []) as CoiOverride[]);
        setRepeated(out.repeated || []);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load the override log");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>COI override log</SheetTitle>
          <SheetDescription>
            Every exception to the block: who granted it, why, and for how long. Overrides that keep recurring on one
            account are the pattern worth acting on — an exception is meant to bridge a gap, not become the arrangement.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              {repeated.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 space-y-1">
                  <p className="text-xs font-bold text-amber-900">Accounts overridden more than once</p>
                  {repeated.map((r) => (
                    <p key={r.accountId} className="text-xs text-amber-800">
                      <strong>{r.name}</strong> — {r.total} overrides{r.active ? `, ${r.active} active now` : ""}
                    </p>
                  ))}
                </div>
              )}
              {overrides.length === 0 && (
                <p className="text-sm text-slate-500">No overrides have ever been granted.</p>
              )}
              {overrides.map((o) => {
                const active = !o.revoked_at && Date.parse(o.expires_at) > Date.now();
                return (
                  <div key={o.id} className={cn(
                    "rounded-lg border px-3 py-2 text-xs",
                    active ? "border-amber-300 bg-amber-50/60" : "border-slate-200",
                  )}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-900">
                        {o.business_accounts?.business_name || "Account"}
                      </span>
                      {active
                        ? <Badge className="border-0 bg-amber-500 text-white">Active</Badge>
                        : o.revoked_at
                          ? <Badge variant="outline">Revoked</Badge>
                          : <Badge variant="outline">Expired</Badge>}
                      {o.coi_status_at_grant && (
                        <span className="text-slate-500">COI was {o.coi_status_at_grant.replace("_", " ")}</span>
                      )}
                    </div>
                    <p className="text-slate-700 mt-1">{o.reason}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {o.created_by_name || "admin"} · granted {format(new Date(o.created_at), "MMM d, yyyy")} ·{" "}
                      {active ? `expires ${format(new Date(o.expires_at), "MMM d, yyyy 'at' HH:mm")}`
                        : o.revoked_at
                          ? `revoked ${format(new Date(o.revoked_at), "MMM d, yyyy")}${o.revoked_reason ? ` — ${o.revoked_reason}` : ""}`
                          : `expired ${format(new Date(o.expires_at), "MMM d, yyyy")}`}
                    </p>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
