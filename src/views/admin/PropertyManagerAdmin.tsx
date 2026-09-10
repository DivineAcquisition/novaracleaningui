"use client";

// ─── Commercial hub → Portfolio ────────────────────────────────────────────
//
// Ops console for the property-manager relationship: create the account,
// register units (standing rates set once), send the tokenized onboarding
// link, work the small review queue, tune volume-discount tiers, and issue
// the period's consolidated invoice. Rates stay Company-set — this screen
// never offers the manager an edit path.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  RiAddLine,
  RiAlarmWarningLine,
  RiCheckboxCircleLine,
  RiFileCopyLine,
  RiHomeSmile2Line,
  RiLoader4Line,
  RiMailSendLine,
  RiPriceTag3Line,
  RiRefreshLine,
} from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  fetchPmAdmin,
  runPmAdmin,
  type PmAdminAccount,
  type PmAdminUnit,
  type PmOnboardingAttentionRow,
  type PmReviewQueueItem,
  type PmVolumeDiscountTier,
} from "@/lib/partner-admin-api";
import { formatRate } from "@/lib/property-manager/pricing";
import { cn } from "@/lib/utils";

const inputCls = "h-9";

function dollarsToCents(raw: string): number | null {
  const n = Number(String(raw).replace(/[$,]/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

export default function PropertyManagerAdmin() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<PmAdminAccount[]>([]);
  const [attention, setAttention] = useState<PmOnboardingAttentionRow[]>([]);
  const [reviewQueue, setReviewQueue] = useState<PmReviewQueueItem[]>([]);
  const [units, setUnits] = useState<PmAdminUnit[]>([]);
  const [discountEnabled, setDiscountEnabled] = useState(true);
  const [tiers, setTiers] = useState<PmVolumeDiscountTier[]>([]);
  const [defaultTiers, setDefaultTiers] = useState<PmVolumeDiscountTier[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [lastLink, setLastLink] = useState<string>("");
  const [expandedReview, setExpandedReview] = useState<string>("");

  const [newCo, setNewCo] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const [unitLabel, setUnitLabel] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [sqft, setSqft] = useState("");
  const [beds, setBeds] = useState("");
  const [baths, setBaths] = useState("");
  const [flagged, setFlagged] = useState(false);

  const [reviewSqft, setReviewSqft] = useState("");
  const [reviewBeds, setReviewBeds] = useState("");
  const [reviewBaths, setReviewBaths] = useState("");
  const [reviewZip, setReviewZip] = useState("");
  const [reviewMoveOut, setReviewMoveOut] = useState("");
  const [reviewMoveIn, setReviewMoveIn] = useState("");
  const [reviewStandard, setReviewStandard] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  const load = useCallback(async (accountId?: string) => {
    setLoading(true);
    try {
      const data = await fetchPmAdmin(accountId);
      setAccounts(data.accounts || []);
      setAttention(data.attention || []);
      setReviewQueue(data.reviewQueue || []);
      setDiscountEnabled(data.discounts?.enabled !== false);
      setTiers((data.discounts?.tiers || []).map((t) => ({ ...t })));
      setDefaultTiers(data.defaultDiscounts?.tiers || []);
      if (accountId) setUnits(data.units || []);
    } catch (err) {
      toast.error((err as Error).message || "Could not load portfolios.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selectedId || undefined);
  }, [load, selectedId]);

  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedId) || null,
    [accounts, selectedId],
  );

  const act = async (key: string, body: Record<string, unknown>, okMessage?: string) => {
    setBusy(key);
    try {
      const result = await runPmAdmin(body);
      if (okMessage || result.message) toast.success(String(result.message || okMessage));
      const link = (result as { link?: string }).link;
      if (link) setLastLink(link);
      await load(selectedId || undefined);
      return result;
    } catch (err) {
      toast.error((err as Error).message || "That didn't work.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const createAccount = async () => {
    const result = await act(
      "create",
      { action: "create_account", companyName: newCo, contactName: newContact, email: newEmail, phone: newPhone },
      "Account created. Register units, then send the setup link.",
    );
    if (!result) return;
    const id = (result as { account?: { id?: string } }).account?.id;
    setNewCo("");
    setNewContact("");
    setNewEmail("");
    setNewPhone("");
    if (id) setSelectedId(id);
  };

  const addUnit = async () => {
    if (!selectedId) {
      toast.error("Select a portfolio first.");
      return;
    }
    const result = await act("add_unit", {
      action: "add_unit",
      pmAccountId: selectedId,
      unitLabel: unitLabel || null,
      address,
      city,
      state,
      zipCode: zip,
      sqft: sqft ? Number(sqft) : null,
      bedrooms: beds ? Number(beds) : null,
      bathrooms: baths ? Number(baths) : null,
      flaggedNonStandard: flagged,
    });
    if (!result) return;
    setUnitLabel("");
    setAddress("");
    setCity("");
    setState("");
    setZip("");
    setSqft("");
    setBeds("");
    setBaths("");
    setFlagged(false);
  };

  const approve = async (unit: PmReviewQueueItem) => {
    const moveOut = dollarsToCents(reviewMoveOut);
    const moveIn = dollarsToCents(reviewMoveIn);
    const standard = dollarsToCents(reviewStandard);
    const anyManual = moveOut != null || moveIn != null || standard != null;
    if (anyManual && (moveOut == null || moveIn == null || standard == null)) {
      toast.error("Manual rates need Move-Out, Move-In, and Standard, or leave all three blank to re-run the engine.");
      return;
    }
    await act(`approve:${unit.id}`, {
      action: "approve_unit",
      unitId: unit.id,
      sqft: reviewSqft ? Number(reviewSqft) : unit.sqft,
      bedrooms: reviewBeds ? Number(reviewBeds) : unit.bedrooms,
      bathrooms: reviewBaths ? Number(reviewBaths) : unit.bathrooms,
      zipCode: reviewZip || unit.zipCode,
      reviewNote: reviewNote || null,
      manualRates: anyManual ? { move_out: moveOut, move_in: moveIn, standard } : null,
    });
    setExpandedReview("");
    setReviewSqft("");
    setReviewBeds("");
    setReviewBaths("");
    setReviewZip("");
    setReviewMoveOut("");
    setReviewMoveIn("");
    setReviewStandard("");
    setReviewNote("");
  };

  const copyLink = async () => {
    if (!lastLink) return;
    try {
      await navigator.clipboard.writeText(lastLink);
      toast.success("Setup link copied.");
    } catch {
      toast.error("Couldn't copy — select the link and copy it.");
    }
  };

  if (loading && accounts.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <RiLoader4Line className="h-8 w-8 animate-spin text-violet-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Property manager portfolios</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Register units once, set standing Move-Out / Move-In / Standard rates, then book turnovers off the lease date.
            Volume discount comes out of company margin — crew pay uses the pre-discount list value.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(selectedId || undefined)} disabled={loading}>
          {loading ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiRefreshLine className="w-4 h-4 mr-1.5" />}
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Portfolios" value={accounts.length} />
        <Stat label="Review queue" value={reviewQueue.length} />
        <Stat label="Onboarding attention" value={attention.length} />
        <Stat
          label="Volume discount"
          value={discountEnabled ? "On" : "Off"}
        />
      </div>

      {lastLink && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2 text-sm">
          <span className="text-violet-800 font-medium">Last setup link</span>
          <code className="text-xs text-violet-900 break-all flex-1">{lastLink}</code>
          <Button size="sm" variant="outline" onClick={copyLink}>
            <RiFileCopyLine className="w-3.5 h-3.5 mr-1" /> Copy
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <RiAddLine className="w-5 h-5" /> New portfolio
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Company">
              <Input className={inputCls} value={newCo} onChange={(e) => setNewCo(e.target.value)} placeholder="Harbor Property Group" />
            </Field>
            <Field label="Contact">
              <Input className={inputCls} value={newContact} onChange={(e) => setNewContact(e.target.value)} placeholder="Jordan Hale" />
            </Field>
            <Field label="Email">
              <Input className={inputCls} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="jordan@harbor.example" />
            </Field>
            <Field label="Phone">
              <Input className={inputCls} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="optional" />
            </Field>
          </div>
          <Button onClick={createAccount} disabled={busy === "create" || !newCo.trim() || !newContact.trim() || !newEmail.trim()}>
            {busy === "create" ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Create account
          </Button>
        </CardContent>
      </Card>

      {attention.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700">
              <RiAlarmWarningLine className="w-5 h-5" /> Onboarding needs attention ({attention.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {attention.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <div className="text-sm">
                  <p className="font-medium">{s.company_name || s.recipient_name || s.recipient_email || "Property manager"}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.stalled
                      ? `Stalled ${Math.round(Number(s.idle_hours || 0))}h on ${s.current_step || "setup"}`
                      : `On ${s.current_step || "setup"}`}
                    {Number(s.pending_items || 0) > 0 ? ` · ${s.pending_items} flag/request` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === `nudge:${s.id}`}
                  onClick={() => act(`nudge:${s.id}`, { action: "nudge", sessionId: s.id }, "Nudge sent.")}
                >
                  {busy === `nudge:${s.id}` ? "Sending…" : "Nudge"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {reviewQueue.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700">
              <RiPriceTag3Line className="w-5 h-5" /> Units awaiting a standing rate ({reviewQueue.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {reviewQueue.map((u) => {
              const open = expandedReview === u.id;
              return (
                <div key={u.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="text-sm">
                      <p className="font-medium">{u.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {u.company || "Portfolio"}
                        {u.sqft ? ` · ${u.sqft} sqft` : " · size missing"}
                        {u.bedrooms != null ? ` · ${u.bedrooms} bd` : ""}
                        {u.zipCode ? ` · ${u.zipCode}` : ""}
                      </p>
                      <p className="text-xs text-amber-800 mt-1">{u.reviewMessage || u.reviewReason || "Needs review"}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setExpandedReview(open ? "" : u.id);
                        setReviewSqft(u.sqft ? String(u.sqft) : "");
                        setReviewBeds(u.bedrooms != null ? String(u.bedrooms) : "");
                        setReviewBaths(u.bathrooms != null ? String(u.bathrooms) : "");
                        setReviewZip(u.zipCode || "");
                      }}
                    >
                      {open ? "Close" : "Price"}
                    </Button>
                  </div>
                  {open && (
                    <div className="space-y-3 rounded-lg border border-white bg-white p-3">
                      <p className="text-xs text-slate-500">
                        Fill size and zip and leave rates blank to re-run the residential engine. Or set all three list rates in dollars — the portfolio discount still comes off margin.
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <Field label="Sqft"><Input className={inputCls} value={reviewSqft} onChange={(e) => setReviewSqft(e.target.value)} /></Field>
                        <Field label="Beds"><Input className={inputCls} value={reviewBeds} onChange={(e) => setReviewBeds(e.target.value)} /></Field>
                        <Field label="Baths"><Input className={inputCls} value={reviewBaths} onChange={(e) => setReviewBaths(e.target.value)} /></Field>
                        <Field label="Zip"><Input className={inputCls} value={reviewZip} onChange={(e) => setReviewZip(e.target.value)} /></Field>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <Field label="Move-Out $"><Input className={inputCls} value={reviewMoveOut} onChange={(e) => setReviewMoveOut(e.target.value)} placeholder="engine" /></Field>
                        <Field label="Move-In $"><Input className={inputCls} value={reviewMoveIn} onChange={(e) => setReviewMoveIn(e.target.value)} placeholder="engine" /></Field>
                        <Field label="Standard $"><Input className={inputCls} value={reviewStandard} onChange={(e) => setReviewStandard(e.target.value)} placeholder="engine" /></Field>
                      </div>
                      <Field label="Note">
                        <Input className={inputCls} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
                      </Field>
                      <Button size="sm" onClick={() => approve(u)} disabled={busy === `approve:${u.id}`}>
                        {busy === `approve:${u.id}` ? "Saving…" : "Approve & store rates"}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <RiHomeSmile2Line className="w-5 h-5" /> Portfolios
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No property manager accounts yet.</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {accounts.map((a) => {
                const active = a.id === selectedId;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedId(active ? "" : a.id)}
                    className={cn(
                      "w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors",
                      active && "bg-violet-50",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{a.company_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.contact_name || "—"} · {a.email || "no email"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-normal">
                          {a.unitCount} unit{a.unitCount === 1 ? "" : "s"}
                        </Badge>
                        {a.pendingReview > 0 && (
                          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{a.pendingReview} review</Badge>
                        )}
                        <Badge variant="outline">{a.status}</Badge>
                        {Number(a.volume_discount_percent) > 0 && (
                          <span className="text-xs text-violet-700">{a.volume_discount_percent}% off</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selected && (
            <div className="space-y-4 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{selected.company_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {selected.billing_method === "auto_pay" ? "Auto-Pay" : "Invoiced"} · {selected.invoice_cycle} · {selected.net_terms.replace("_", " ")}
                    {selected.portal_provisioned_at ? " · portal live" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === "send" || selected.activeUnits < 1}
                    onClick={() =>
                      act("send", { action: "send", pmAccountId: selected.id }, "Setup link sent.")
                    }
                    title={selected.activeUnits < 1 ? "Price at least one unit before sending onboarding." : undefined}
                  >
                    {busy === "send" ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiMailSendLine className="w-4 h-4 mr-1.5" />}
                    Send setup link
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === "reprice"}
                    onClick={() => act("reprice", { action: "reprice", pmAccountId: selected.id })}
                  >
                    Reprice portfolio
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === "preview_inv"}
                    onClick={() => act("preview_inv", { action: "issue_invoice", pmAccountId: selected.id, dryRun: true })}
                  >
                    Preview invoice
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy === "issue"}
                    onClick={() => act("issue", { action: "issue_invoice", pmAccountId: selected.id })}
                  >
                    Issue last period
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Register a unit</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  <Field label="Label" className="lg:col-span-1">
                    <Input className={inputCls} value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} placeholder="2B Adams" />
                  </Field>
                  <Field label="Street" className="sm:col-span-2">
                    <Input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="118 Adams St" />
                  </Field>
                  <Field label="Zip">
                    <Input className={inputCls} value={zip} onChange={(e) => setZip(e.target.value)} />
                  </Field>
                  <Field label="City">
                    <Input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} />
                  </Field>
                  <Field label="State">
                    <Input className={inputCls} value={state} onChange={(e) => setState(e.target.value)} />
                  </Field>
                  <Field label="Sqft">
                    <Input className={inputCls} value={sqft} onChange={(e) => setSqft(e.target.value)} />
                  </Field>
                  <Field label="Beds">
                    <Input className={inputCls} value={beds} onChange={(e) => setBeds(e.target.value)} />
                  </Field>
                  <Field label="Baths">
                    <Input className={inputCls} value={baths} onChange={(e) => setBaths(e.target.value)} />
                  </Field>
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />
                  Flag as non-standard (routes to review; does not block registration)
                </label>
                <Button className="mt-3" size="sm" onClick={addUnit} disabled={busy === "add_unit" || address.trim().length < 5}>
                  {busy === "add_unit" ? "Registering…" : "Register unit"}
                </Button>
              </div>

              {units.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="py-1 pr-3 font-semibold">Unit</th>
                        <th className="py-1 pr-3 font-semibold">Status</th>
                        <th className="py-1 pr-3 font-semibold">Move-Out</th>
                        <th className="py-1 pr-3 font-semibold">Move-In</th>
                        <th className="py-1 font-semibold">Standard</th>
                      </tr>
                    </thead>
                    <tbody>
                      {units.map((u) => {
                        const rate = (service: string) => u.rates.find((r) => r.service === service)?.standingCents;
                        return (
                          <tr key={u.id} className="border-t border-violet-100">
                            <td className="py-1.5 pr-3">
                              <div className="font-medium">{u.label}</div>
                              <div className="text-xs text-muted-foreground">
                                {u.sqft ? `${u.sqft} sqft` : "size —"}
                                {u.zipCode ? ` · ${u.zipCode}` : ""}
                              </div>
                            </td>
                            <td className="py-1.5 pr-3">
                              {u.bookable ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 text-xs">
                                  <RiCheckboxCircleLine className="w-3.5 h-3.5" /> Bookable
                                </span>
                              ) : (
                                <span className="text-xs text-amber-700">{u.status.replace("_", " ")}</span>
                              )}
                            </td>
                            <td className="py-1.5 pr-3 tabular-nums">{formatRate(rate("move_out"))}</td>
                            <td className="py-1.5 pr-3 tabular-nums">{formatRate(rate("move_in"))}</td>
                            <td className="py-1.5 tabular-nums">{formatRate(rate("standard"))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-slate-400 mt-2">Standing rates are read-only for the manager. Cleaner pay uses the pre-discount list value stored on the unit.</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Volume discount tiers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Saving rewrites standing rates on every live unit. Crew pay is unchanged — it is computed from the pre-discount list value.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={discountEnabled} onChange={(e) => setDiscountEnabled(e.target.checked)} />
            Discount enabled
          </label>
          <div className="space-y-2">
            {tiers.map((t, i) => (
              <div key={`${t.min_units}-${i}`} className="grid grid-cols-3 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                <Field label="Min units">
                  <Input
                    className={inputCls}
                    value={String(t.min_units)}
                    onChange={(e) => {
                      const next = [...tiers];
                      next[i] = { ...next[i], min_units: Number(e.target.value) || 0 };
                      setTiers(next);
                    }}
                  />
                </Field>
                <Field label="Percent off">
                  <Input
                    className={inputCls}
                    value={String(t.percent)}
                    onChange={(e) => {
                      const next = [...tiers];
                      next[i] = { ...next[i], percent: Number(e.target.value) || 0 };
                      setTiers(next);
                    }}
                  />
                </Field>
                <Field label="Label">
                  <Input
                    className={inputCls}
                    value={t.label || ""}
                    onChange={(e) => {
                      const next = [...tiers];
                      next[i] = { ...next[i], label: e.target.value };
                      setTiers(next);
                    }}
                  />
                </Field>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mb-0.5"
                  onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setTiers([...tiers, { min_units: 0, percent: 0, label: "" }])}>
              Add tier
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setTiers(defaultTiers.map((t) => ({ ...t })))}>
              Reset to defaults
            </Button>
            <Button
              size="sm"
              disabled={busy === "tiers"}
              onClick={() =>
                act("tiers", { action: "set_discount_tiers", enabled: discountEnabled, tiers }, "Tiers saved.")
              }
            >
              {busy === "tiers" ? "Saving…" : "Save & reprice all portfolios"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          variant="outline"
          disabled={busy === "issue_all"}
          onClick={() => act("issue_all", { action: "issue_all_invoices" }, "Ran last-period invoicing for every active portfolio.")}
        >
          Issue last closed period for all active portfolios
        </Button>
      </div>
    </div>
  );
}
