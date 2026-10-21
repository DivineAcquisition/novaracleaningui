"use client";

// ─── /membership-pay/[token] — sign-then-pay for Glow memberships ──────────
//
// The recurring / membership analogue of /pay/[token]. Sent to customers
// (SMS/email) when a VA/admin sets up a recurring plan. One mobile-first page,
// two gated steps:
//
//   1. LEGAL — required checkboxes (Membership / Recurring Service Agreement,
//      Terms of Service + Refund Policy, Disclaimer) + typed legal name +
//      drawn signature. The signed agreement PDF is stored server-side BEFORE
//      the payment link is ever revealed, and the membership-pay-page edge
//      function refuses to hand back the Stripe subscription URL until the
//      accepted agreement exists (server-enforced, not just UI).
//   2. PAYMENT — the customer is handed off to the hosted Stripe subscription
//      Checkout to add their card and activate the membership.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiLockLine,
  RiQuillPenLine,
  RiRepeatLine,
  RiShieldCheckLine,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buildSignedAgreementBase64 } from "@/lib/service-agreement";
import { SignaturePad } from "@/components/booking/SignaturePad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AcceptanceChecklist, type AcceptanceGateState } from "@/components/compliance/AcceptanceChecklist";
import { submitAcceptances, submitSignedCopy } from "@/lib/compliance/record-client";
import { Skeleton } from "@/components/ui/skeleton";
import { SEO } from "@/components/SEO";
import { IncludedValueStack } from "@/components/booking/IncludedValueStack";
import { BrandAtmosphere } from "@/components/brand/atmosphere";

interface MembershipSummary {
  scheduleId: string;
  firstName: string;
  lastName: string;
  email: string;
  plan: string;
  planLabel: string;
  cadence: string | null;
  perCleanCents: number;
  firstServiceDate: string | null;
  timeSlot: string | null;
  city: string;
  state: string;
  agreementSigned: boolean;
  active: boolean;
  payUrl: string | null;
  plans?: { cadence: string; label: string; cents: number; selected: boolean }[];
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function MembershipPayPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");

  const [summary, setSummary] = useState<MembershipSummary | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [acceptanceGate, setAcceptanceGate] = useState<AcceptanceGateState | null>(null);
  const [showAcceptanceErrors, setShowAcceptanceErrors] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  // Pay step state
  const [payUrl, setPayUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("membership-pay-page", {
        body: { action: "get", token },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; membership?: MembershipSummary };
      if (!d?.ok || !d.membership) throw new Error(d?.error || "not_found");
      setSummary(d.membership);
      if (d.membership.payUrl) setPayUrl(d.membership.payUrl);
      if (d.membership.firstName || d.membership.lastName) {
        setLegalName((prev) => prev || `${d.membership!.firstName} ${d.membership!.lastName}`.trim());
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadErr(msg.includes("cancelled") ? "cancelled" : "not_found");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  const allAccepted = acceptanceGate?.ready === true;
  const canSign = allAccepted && legalName.trim().length >= 3 && !!signatureDataUrl;

  const handleSign = async () => {
    if (!summary || !canSign || !signatureDataUrl) return;
    setSigning(true);
    try {
      const pdfBase64 = await buildSignedAgreementBase64({
        variant: "membership",
        name: legalName.trim(),
        email: summary.email,
        planLabel: summary.planLabel,
        perCleanCents: summary.perCleanCents,
        serviceDate: summary.firstServiceDate
          ? format(new Date(`${summary.firstServiceDate}T12:00:00`), "EEEE, MMM d, yyyy")
          : undefined,
        signatureDataUrl,
      });
      const { data, error } = await supabase.functions.invoke("membership-pay-page", {
        body: {
          action: "sign",
          token,
          name: legalName.trim(),
          agreed: acceptanceGate?.legacy || { terms: false, disclaimer: false, refund: false, serviceAgreement: false },
          pdfBase64,
        },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; payUrl?: string | null };
      if (!d?.ok) throw new Error(d?.error || "Could not record your agreement");
      if (acceptanceGate) {
        const lines = acceptanceGate.items
          .filter((item) => acceptanceGate.checked[item.kind])
          .map((item) => item.wordingShown);
        void submitAcceptances({
          surface: "membership_pay",
          context: {
            relationship: "residential",
            includeMembership: true,
            includeCard: true,
            propertyLabel: summary.city ? `${summary.city}, ${summary.state}` : "this home",
            charge: {
              dueNowLabel: money(summary.perCleanCents),
              dueNowWhen: "when the membership payment is submitted",
              amountBasis: `${summary.planLabel} at ${money(summary.perCleanCents)} per visit`,
              savedFor: "for recurring membership charges until you cancel",
            },
            membership: {
              pricePerVisit: money(summary.perCleanCents),
              frequency: summary.planLabel,
              firstChargeLabel: money(summary.perCleanCents),
              firstChargeWhen: "when you submit payment",
              nextChargeWhen: "on the next billing date",
            },
          },
          items: acceptanceGate.items,
          checked: acceptanceGate.checked,
          personName: legalName.trim(),
          email: summary.email,
          bookingId: summary.scheduleId,
        }).catch(() => undefined);
        void submitSignedCopy({ email: summary.email, bookingId: summary.scheduleId, lines }).catch(() => undefined);
      }
      toast.success("Agreement signed. One more step — activate your membership.");
      setSummary((s) => (s ? { ...s, agreementSigned: true } : s));
      if (d.payUrl) setPayUrl(d.payUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record your agreement");
    } finally {
      setSigning(false);
    }
  };

  // ── Render states ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="relative min-h-screen bg-background p-4 max-w-md mx-auto space-y-4">
        <BrandAtmosphere />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (loadErr || !summary) {
    return (
      <div className="relative min-h-screen bg-background p-4 max-w-md mx-auto">
        <BrandAtmosphere />
        <SEO title="Membership link" noindex />
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900 mt-8">
          <p className="font-semibold flex items-center gap-1.5">
            <RiErrorWarningLine className="w-4 h-4" />
            {loadErr === "cancelled" ? "This membership was cancelled." : "This link isn't valid anymore."}
          </p>
          <p className="text-xs mt-1">
            If you believe this is a mistake, call us at{" "}
            <a href="tel:+18447352070" className="underline">(844) 735-2070</a> and we&apos;ll sort it out.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background pb-16">
      <BrandAtmosphere />
      <SEO title="Sign and pay for your membership — Novara Cleaning" noindex />
      <div className="relative z-10 max-w-md mx-auto p-4 space-y-4">
        {/* Membership summary */}
        <header className="token-hero">
          <div className="flex items-center gap-2">
            <RiRepeatLine className="w-5 h-5" />
            <p className="text-sm font-semibold">
              Hi {summary.firstName || "there"} — your membership
            </p>
          </div>
          <p className="mt-2 text-xs text-white/80 leading-snug">
            {summary.planLabel}
            <span className="block">
              {summary.firstServiceDate
                ? `First clean ${format(new Date(`${summary.firstServiceDate}T12:00:00`), "EEEE, MMM d")}`
                : ""}
              {summary.timeSlot ? ` · ${summary.timeSlot}` : ""}
              {summary.city ? ` · ${summary.city}, ${summary.state}` : ""}
            </span>
          </p>
          {summary.perCleanCents > 0 && (
            <div className="mt-3 rounded-xl bg-white/15 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wide text-white/70">Monthly price</p>
              <p className="text-sm font-bold">{money(summary.perCleanCents)}</p>
            </div>
          )}
          <p className="mt-2 text-[11px] text-white/80 leading-snug">
            Sign, then submit payment to start this membership. Cancel anytime.
          </p>
        </header>

        {!summary.agreementSigned ? (
          /* ── STEP 1: LEGAL (required before payment unlocks) ── */
          <>
          <IncludedValueStack serviceType={summary.plan || summary.cadence || "recurring"} compact />
          <div className="token-card space-y-4">
            <div className="flex items-center gap-2">
              <RiQuillPenLine className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">Step 1 of 2 — Review &amp; sign</p>
            </div>

            <AcceptanceChecklist
              surface="membership_pay"
              showErrors={showAcceptanceErrors}
              onChange={setAcceptanceGate}
              context={{
                relationship: "residential",
                includeMembership: true,
                includeCard: true,
                propertyLabel: summary.city ? `${summary.city}, ${summary.state}` : "this home",
                charge: {
                  dueNowLabel: money(summary.perCleanCents),
                  dueNowWhen: "when the membership payment is submitted",
                  amountBasis: `${summary.planLabel} at ${money(summary.perCleanCents)} per visit`,
                  savedFor: "for recurring membership charges until you cancel",
                },
                membership: {
                  pricePerVisit: money(summary.perCleanCents),
                  frequency: summary.planLabel,
                  firstChargeLabel: money(summary.perCleanCents),
                  firstChargeWhen: "when you submit payment",
                  nextChargeWhen: "on the next billing date",
                },
              }}
            />

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Your full legal name</Label>
              <Input
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Full legal name"
                autoComplete="name"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Sign below</Label>
              <div className="rounded-xl border border-[color:var(--hairline)] bg-brand-50/40 overflow-hidden">
                <SignaturePad onChange={setSignatureDataUrl} />
              </div>
            </div>

            <Button
              className="w-full h-12"
              disabled={signing || legalName.trim().length < 3 || !signatureDataUrl}
              onClick={() => {
                if (!allAccepted) {
                  setShowAcceptanceErrors(true);
                  return;
                }
                void handleSign();
              }}
            >
              {signing ? (
                <><RiLoader4Line className="w-5 h-5 mr-2 animate-spin" /> Saving your agreement…</>
              ) : (
                <><RiShieldCheckLine className="w-5 h-5 mr-2" /> Agree &amp; continue to payment</>
              )}
            </Button>
            {!allAccepted && (
              <p className="text-[11px] text-muted-foreground text-center">
                Check each required agreement, including the membership terms beside this button, then sign.
              </p>
            )}
          </div>
          </>
        ) : (
          /* ── STEP 2: PAYMENT (only reachable after the signed agreement) ── */
          <div className="token-card space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RiLockLine className="w-4 h-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">Step 2 of 2 — Activate membership</p>
              </div>
              <span className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                <RiCheckboxCircleLine className="w-3.5 h-3.5" /> Agreement signed
              </span>
            </div>

            {payUrl ? (
              <>
                <p className="text-xs text-muted-foreground leading-snug">
                  Thanks for signing! Tap below to securely add your card on Stripe and activate
                  your {summary.planLabel}. Your first clean is booked once payment is complete.
                </p>
                <a href={payUrl} target="_self" rel="noopener noreferrer">
                  <Button className="w-full h-12">
                    <RiLockLine className="w-5 h-5 mr-2" /> Continue to secure payment
                  </Button>
                </a>
              </>
            ) : (
              <div className="py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Your agreement is signed. We&apos;ll send your secure payment link shortly — or call{" "}
                  <a href="tel:+18447352070" className="underline">(844) 735-2070</a>.
                </p>
              </div>
            )}
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          Questions? Call <a href="tel:+18447352070" className="underline">(844) 735-2070</a> — Novara Cleaning
        </p>
      </div>
    </div>
  );
}
