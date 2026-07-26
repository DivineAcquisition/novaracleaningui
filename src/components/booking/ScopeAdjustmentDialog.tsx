"use client";

// ─── Scope adjustment dialog ─────────────────────────────────────────────
//
// Applies a documented price increase to a job that turned out materially
// different from the one booked. The form deliberately refuses to let an
// adjustment through until it can stand on its own:
//
//   * a defined reason is selected (free text alone is not a justification)
//   * the job's own condition photos are attached as evidence, or an explicit
//     override is written down and the adjustment is marked unsupported
//   * the amount comes from the pricing engine, or carries a note saying why
//     it doesn't
//   * the customer message is drafted, shown, and editable before it sends
//
// The server re-checks every one of these; this is the humane version.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAlertLine,
  RiCheckLine,
  RiImageLine,
  RiLoader4Line,
  RiPriceTag3Line,
  RiShieldCheckLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING } from "@/lib/pricing";
import {
  draftJustificationMessage,
  suggestScopeAdjustment,
  type ScopeReason,
} from "@/lib/scope-adjustment";
import { cn } from "@/lib/utils";

const fmtMoney = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

interface Context {
  booking: {
    id: string;
    bookingNumber: number | null;
    firstName: string | null;
    status: string | null;
    serviceType: string | null;
    homeSizeId: string | null;
    addOns: string[];
    membershipPlan: string;
    usesCredit: boolean;
    serviceDate: string | null;
    originalPriceCents: number;
    adjustable: boolean;
    payoutStatus: string | null;
    cleanerPayoutCents: number | null;
  };
  reasons: ScopeReason[];
  evidencePhotos: { before: string[]; after: string[] };
  history: Array<Record<string, unknown>>;
}

export function ScopeAdjustmentDialog({
  open,
  onOpenChange,
  bookingId,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  onApplied: () => void;
}) {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [adjustedServiceType, setAdjustedServiceType] = useState<string>("");
  const [adjustedHomeSizeId, setAdjustedHomeSizeId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [evidenceOverrideNote, setEvidenceOverrideNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [message, setMessage] = useState("");
  const [messageTouched, setMessageTouched] = useState(false);
  const [sendSms, setSendSms] = useState(true);
  const [sendEmail, setSendEmail] = useState(true);

  const authedFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not signed in");
    return fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...(init?.headers || {}),
      },
    });
  }, []);

  // Load the job's context whenever the dialog opens.
  useEffect(() => {
    if (!open || !bookingId) return;
    setLoading(true);
    setSelectedReasons([]);
    setOverrideNote("");
    setEvidenceOverrideNote("");
    setInternalNote("");
    setMessage("");
    setMessageTouched(false);
    setSendSms(true);
    setSendEmail(true);
    void (async () => {
      try {
        const res = await authedFetch(`/api/admin/scope-adjustment?bookingId=${bookingId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Could not load the job");
        setCtx(data as Context);
        setAdjustedServiceType(data.booking.serviceType || "standard");
        setAdjustedHomeSizeId(data.booking.homeSizeId || "");
        // Condition evidence is what justifies the increase, so start with
        // every photo on the job attached rather than making it opt-in.
        setSelectedPhotos([...data.evidencePhotos.before, ...data.evidencePhotos.after]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not load the job");
        onOpenChange(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, bookingId, authedFetch, onOpenChange]);

  const allPhotos = useMemo(
    () => [...(ctx?.evidencePhotos.before || []), ...(ctx?.evidencePhotos.after || [])],
    [ctx],
  );

  // Live pricing suggestion — the same function the server re-runs on submit.
  const suggestion = useMemo(() => {
    if (!ctx) return null;
    return suggestScopeAdjustment({
      homeSizeId: ctx.booking.homeSizeId,
      addOns: ctx.booking.addOns,
      membershipPlan: ctx.booking.membershipPlan,
      usesCredit: ctx.booking.usesCredit,
      originalServiceType: ctx.booking.serviceType,
      adjustedServiceType,
      adjustedHomeSizeId,
      originalPriceCents: ctx.booking.originalPriceCents,
    });
  }, [ctx, adjustedServiceType, adjustedHomeSizeId]);

  // Follow the suggestion until the admin types their own number.
  const [amountTouched, setAmountTouched] = useState(false);
  useEffect(() => {
    if (!suggestion || amountTouched) return;
    if (!suggestion.unpriced) setAmount((suggestion.suggestedPriceCents / 100).toFixed(2));
  }, [suggestion, amountTouched]);

  const amountCents = Math.round(parseFloat(amount || "0") * 100);
  const amountOverridden =
    !!suggestion && (suggestion.unpriced || (Number.isFinite(amountCents) && amountCents !== suggestion.suggestedPriceCents));
  const evidenceMissing = selectedPhotos.length === 0;

  // Keep the drafted message in step with the inputs until it's hand-edited.
  useEffect(() => {
    if (!ctx || messageTouched) return;
    setMessage(
      draftJustificationMessage({
        firstName: ctx.booking.firstName,
        reasons: ctx.reasons,
        selectedCodes: selectedReasons,
        adjustedServiceType,
        adjustedPriceCents: Number.isFinite(amountCents) ? amountCents : 0,
        serviceDate: ctx.booking.serviceDate,
        hasPhotoEvidence: !evidenceMissing,
      }),
    );
  }, [ctx, selectedReasons, adjustedServiceType, amountCents, evidenceMissing, messageTouched]);

  const toggleReason = (code: string) =>
    setSelectedReasons((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  const togglePhoto = (url: string) =>
    setSelectedPhotos((prev) => (prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]));

  const blockers: string[] = [];
  if (ctx) {
    if (selectedReasons.length === 0) blockers.push("Select at least one reason.");
    if (!Number.isFinite(amountCents) || amountCents <= ctx.booking.originalPriceCents) {
      blockers.push(`The adjusted price must be above ${fmtMoney(ctx.booking.originalPriceCents)}.`);
    }
    if (evidenceMissing && !evidenceOverrideNote.trim()) {
      blockers.push("Attach condition photos, or write an override to proceed unsupported.");
    }
    if (amountOverridden && !overrideNote.trim()) blockers.push("Explain the amount you set.");
    if (!message.trim()) blockers.push("The customer message cannot be empty.");
  }

  const apply = async () => {
    if (!ctx) return;
    setSaving(true);
    try {
      const res = await authedFetch("/api/admin/scope-adjustment", {
        method: "POST",
        body: JSON.stringify({
          bookingId,
          reasonCodes: selectedReasons,
          adjustedServiceType,
          adjustedHomeSizeId: adjustedHomeSizeId || undefined,
          adjustedPriceCents: amountCents,
          evidencePhotos: selectedPhotos,
          evidenceOverrideNote: evidenceOverrideNote.trim() || undefined,
          overrideNote: overrideNote.trim() || undefined,
          internalNote: internalNote.trim() || undefined,
          customerMessage: message.trim(),
          sendSms,
          sendEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not apply the adjustment");
      const sent = (data.channels || []) as string[];
      toast.success(
        `Scope adjusted to ${fmtMoney(data.adjustedPriceCents)}${sent.length ? ` · customer notified by ${sent.join(" + ")}` : " · no message sent"}`,
      );
      if (data.payout?.supplementCents > 0) {
        toast.warning(
          `Payout already went out at the old value — ${fmtMoney(data.payout.supplementCents)} per cleaner is owed and flagged for payroll.`,
        );
      }
      onApplied();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply the adjustment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiPriceTag3Line className="w-5 h-5 text-violet-700" />
            Scope adjustment
          </DialogTitle>
          <DialogDescription>
            For a job that turned out materially different from what was booked. Every adjustment needs a
            defined reason and the job&apos;s condition photos, and the customer gets a written justification.
          </DialogDescription>
        </DialogHeader>

        {loading || !ctx ? (
          <div className="py-12 flex items-center justify-center text-slate-500">
            <RiLoader4Line className="w-5 h-5 animate-spin mr-2" /> Loading job…
          </div>
        ) : (
          <div className="space-y-5">
            {/* Original vs adjusted */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">As booked</p>
                <p className="font-semibold text-slate-900 tabular-nums">
                  {fmtMoney(ctx.booking.originalPriceCents)}
                </p>
                <p className="text-xs text-slate-600">
                  {SERVICE_TIER_PRICING[(ctx.booking.serviceType || "standard") as keyof typeof SERVICE_TIER_PRICING]?.label ||
                    ctx.booking.serviceType}
                  {ctx.booking.homeSizeId ? ` · ${HOME_SIZE_RANGES.find((h) => h.id === ctx.booking.homeSizeId)?.label || ctx.booking.homeSizeId}` : ""}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Adjusted to</p>
                <p className="font-semibold text-violet-800 tabular-nums">
                  {Number.isFinite(amountCents) && amountCents > 0 ? fmtMoney(amountCents) : "—"}
                  {Number.isFinite(amountCents) && amountCents > ctx.booking.originalPriceCents && (
                    <span className="ml-2 text-xs font-normal text-emerald-700">
                      +{fmtMoney(amountCents - ctx.booking.originalPriceCents)}
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-600">
                  {SERVICE_TIER_PRICING[adjustedServiceType as keyof typeof SERVICE_TIER_PRICING]?.label || adjustedServiceType}
                </p>
              </div>
            </div>

            {/* Reasons */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Justification — required
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ctx.reasons.map((r) => {
                  const on = selectedReasons.includes(r.code);
                  return (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => toggleReason(r.code)}
                      className={cn(
                        "text-left rounded-lg border p-2.5 transition-colors",
                        on ? "border-violet-400 bg-violet-50" : "border-slate-200 hover:bg-slate-50",
                      )}
                    >
                      <span className="flex items-start gap-2">
                        <span
                          className={cn(
                            "mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0",
                            on ? "bg-violet-600 border-violet-600" : "border-slate-300",
                          )}
                        >
                          {on && <RiCheckLine className="w-3 h-3 text-white" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-900">{r.label}</span>
                          {!r.customer_facing && (
                            <Badge variant="outline" className="mt-1 text-[10px] border-amber-300 text-amber-800">
                              Internal only — kept out of customer copy
                            </Badge>
                          )}
                          {r.internal_hint && (
                            <span className="block text-[11px] text-slate-500 mt-0.5">{r.internal_hint}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <Separator />

            {/* Reclassification + pricing-engine suggestion */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Reclassified scope
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Service type</Label>
                  <Select value={adjustedServiceType} onValueChange={setAdjustedServiceType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SERVICE_TIER_PRICING).map(([id, t]) => (
                        <SelectItem key={id} value={id}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Size band (if larger than booked)</Label>
                  <Select value={adjustedHomeSizeId} onValueChange={setAdjustedHomeSizeId}>
                    <SelectTrigger><SelectValue placeholder="As booked" /></SelectTrigger>
                    <SelectContent>
                      {HOME_SIZE_RANGES.map((h) => (
                        <SelectItem key={h.id} value={h.id}>{h.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {suggestion && !suggestion.unpriced ? (
                <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
                  <p className="text-violet-900">
                    Pricing engine suggests{" "}
                    <strong className="tabular-nums">{fmtMoney(suggestion.suggestedPriceCents)}</strong>{" "}
                    <span className="text-violet-700">
                      (+{fmtMoney(suggestion.suggestedDeltaCents)} for the reclassified scope)
                    </span>
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 border-violet-300 text-violet-800 hover:bg-violet-100"
                    onClick={() => {
                      setAmount((suggestion.suggestedPriceCents / 100).toFixed(2));
                      setAmountTouched(true);
                      setOverrideNote("");
                    }}
                  >
                    Use suggested price
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  Nothing is reclassified yet, so the pricing engine has no suggestion. Change the service type or
                  size band to price this off the model, or set an amount and explain it below.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Adjusted price (USD)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setAmountTouched(true); }}
                    placeholder="0.00"
                  />
                </div>
                {amountOverridden && (
                  <div>
                    <Label className="text-xs text-amber-800">Why this amount — required</Label>
                    <Input
                      value={overrideNote}
                      onChange={(e) => setOverrideNote(e.target.value)}
                      placeholder="e.g. Half the deep-clean delta — only the kitchen was affected"
                    />
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Photo evidence */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Photo evidence — required
              </Label>
              {allPhotos.length === 0 ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                  <p className="text-sm text-amber-900 flex items-center gap-1.5">
                    <RiAlertLine className="w-4 h-4" /> This job has no photos on file.
                  </p>
                  <p className="text-xs text-amber-800">
                    An adjustment without evidence will be recorded as <strong>unsupported</strong> and reported as
                    such. Get the condition photos onto the job if you can — otherwise write the override below.
                  </p>
                  <Input
                    value={evidenceOverrideNote}
                    onChange={(e) => setEvidenceOverrideNote(e.target.value)}
                    placeholder="Override: why this is being applied without photo evidence"
                  />
                </div>
              ) : (
                <>
                  <p className="text-xs text-slate-500">
                    {selectedPhotos.length} of {allPhotos.length} attached. Click to include or exclude.
                  </p>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-52 overflow-y-auto">
                    {allPhotos.map((url) => {
                      const on = selectedPhotos.includes(url);
                      return (
                        <button
                          key={url}
                          type="button"
                          onClick={() => togglePhoto(url)}
                          className={cn(
                            "relative aspect-square rounded-md overflow-hidden border-2 transition",
                            on ? "border-violet-500" : "border-transparent opacity-50 hover:opacity-80",
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="Job condition" className="w-full h-full object-cover" />
                          {on && (
                            <span className="absolute top-1 right-1 bg-violet-600 rounded-full p-0.5">
                              <RiCheckLine className="w-3 h-3 text-white" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {evidenceMissing && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
                      <p className="text-sm text-amber-900 flex items-center gap-1.5">
                        <RiAlertLine className="w-4 h-4" /> No photos attached — this will be flagged unsupported.
                      </p>
                      <Input
                        value={evidenceOverrideNote}
                        onChange={(e) => setEvidenceOverrideNote(e.target.value)}
                        placeholder="Override: why this is being applied without photo evidence"
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div>
              <Label className="text-xs">Internal note (never sent to the customer)</Label>
              <Textarea
                rows={2}
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                placeholder="The candid detail — what the crew actually walked into."
              />
            </div>

            <Separator />

            {/* Customer message */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Customer justification
                </Label>
                {messageTouched && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={() => setMessageTouched(false)}
                  >
                    Reset to draft
                  </Button>
                )}
              </div>
              <Textarea
                rows={6}
                value={message}
                onChange={(e) => { setMessage(e.target.value); setMessageTouched(true); }}
              />
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <Switch checked={sendSms} onCheckedChange={setSendSms} /> Send SMS
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <Switch checked={sendEmail} onCheckedChange={setSendEmail} /> Send email
                </label>
              </div>
            </div>

            {/* Cleaner pay assurance */}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 flex gap-2">
              <RiShieldCheckLine className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                The crew is paid off the adjusted job value for the work they actually did. If the customer ends up
                paying less, the difference comes out of the company — never their pay.
                {ctx.booking.payoutStatus === "completed" && (
                  <strong className="block mt-1">
                    This payout already went out at the old value, so the shortfall will be flagged for payroll as a
                    supplement.
                  </strong>
                )}
              </span>
            </div>

            {blockers.length > 0 && (
              <ul className="text-xs text-slate-500 space-y-0.5">
                {blockers.map((b) => (
                  <li key={b}>• {b}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={apply}
            disabled={saving || loading || !ctx || blockers.length > 0}
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            {saving ? (
              <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Applying…</>
            ) : (
              <><RiImageLine className="w-4 h-4 mr-2" /> Apply &amp; notify customer</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
