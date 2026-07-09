"use client";

// ─── /pay/[token] — custom deposit checkout for internal bookings ──────────
//
// Sent to customers (SMS/email) instead of a raw Stripe Checkout link when a
// VA/admin books them over the phone. One mobile-first page, two gated steps:
//
//   1. LEGAL — required checkboxes (One-Time Service Agreement, Terms of
//      Service, Disclaimer) + typed legal name + drawn signature. The signed
//      agreement PDF is stored server-side BEFORE payment ever unlocks, and
//      the booking-pay-page edge function refuses to mint a PaymentIntent
//      until the accepted agreement exists (server-enforced, not just UI).
//   2. PAYMENT — embedded Stripe Payment Element charging the deposit and
//      saving the card off-session, which is what lets the existing
//      prepare-completion-hold cron place the pre-auth hold before service
//      and capture it on completion (that machinery is untouched).

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Elements } from "@stripe/react-stripe-js";
import type { Stripe } from "@stripe/stripe-js";
import {
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiLockLine,
  RiQuillPenLine,
  RiShieldCheckLine,
  RiSparklingLine,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getStripePromise } from "@/lib/stripe-client";
import { buildSignedAgreementBase64 } from "@/lib/service-agreement";
import { SignaturePad } from "@/components/booking/SignaturePad";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { SEO } from "@/components/SEO";

interface PaySummary {
  bookingId: string;
  bookingNumber: number | null;
  status: string | null;
  firstName: string;
  lastName: string;
  email: string;
  serviceType: string;
  serviceDate: string | null;
  timeSlot: string | null;
  city: string;
  state: string;
  totalCents: number;
  depositCents: number;
  remainingCents: number;
  agreementSigned: boolean;
  paid: boolean;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const SERVICE_LABELS: Record<string, string> = {
  standard: "Standard Clean",
  deep: "Deep Clean",
  moveInOut: "Move In/Out Clean",
  combo: "Deep + Standard Combo",
};

export default function PayPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = String(params?.token || "");

  const [summary, setSummary] = useState<PaySummary | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Legal step state
  const [agreeService, setAgreeService] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeDisclaimer, setAgreeDisclaimer] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  // Payment step state
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [intentLoading, setIntentLoading] = useState(false);
  const [paidNow, setPaidNow] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("booking-pay-page", {
        body: { action: "get", token },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; booking?: PaySummary };
      if (!d?.ok || !d.booking) throw new Error(d?.error || "not_found");
      setSummary(d.booking);
      if (d.booking.firstName || d.booking.lastName) {
        setLegalName((prev) => prev || `${d.booking!.firstName} ${d.booking!.lastName}`.trim());
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

  // Fallback for a 3DS redirect that lands back here instead of the
  // confirmation page (older links): show the paid state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const rs = new URLSearchParams(window.location.search).get("redirect_status");
    if (rs === "succeeded") setPaidNow(true);
  }, []);

  // After a successful deposit: hand off to the booking confirmation page.
  const goToConfirmation = useCallback(() => {
    if (summary?.bookingId) {
      router.push(`/book/confirmation?booking_id=${summary.bookingId}&deposit=ok`);
    } else {
      setPaidNow(true);
    }
  }, [router, summary]);

  // Once the agreement is signed, fetch the PaymentIntent (server re-checks
  // the agreement before minting) and warm Stripe.js.
  const startPayment = useCallback(async () => {
    setIntentLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("booking-pay-page", {
        body: { action: "intent", token },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; paid?: boolean; clientSecret?: string };
      if (d?.paid) {
        setPaidNow(true);
        return;
      }
      if (!d?.ok || !d.clientSecret) throw new Error(d?.error || "Could not start payment");
      setStripePromise(getStripePromise());
      setClientSecret(d.clientSecret);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start payment");
    } finally {
      setIntentLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (summary?.agreementSigned && !summary.paid && !clientSecret) void startPayment();
  }, [summary, clientSecret, startPayment]);

  const serviceLabel = summary ? (SERVICE_LABELS[summary.serviceType] || summary.serviceType) : "";

  const allAccepted = agreeService && agreeTerms && agreeDisclaimer;
  const canSign = allAccepted && legalName.trim().length >= 3 && !!signatureDataUrl;

  const handleSign = async () => {
    if (!summary || !canSign || !signatureDataUrl) return;
    setSigning(true);
    try {
      const pdfBase64 = await buildSignedAgreementBase64({
        name: legalName.trim(),
        email: summary.email,
        serviceType: serviceLabel,
        serviceDate: summary.serviceDate
          ? format(new Date(`${summary.serviceDate}T12:00:00`), "EEEE, MMM d, yyyy")
          : undefined,
        totalCents: summary.totalCents,
        depositCents: summary.depositCents,
        balanceCents: summary.remainingCents,
        signatureDataUrl,
      });
      const { data, error } = await supabase.functions.invoke("booking-pay-page", {
        body: {
          action: "sign",
          token,
          name: legalName.trim(),
          agreed: { terms: agreeTerms, disclaimer: agreeDisclaimer, serviceAgreement: agreeService, refund: true },
          pdfBase64,
        },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string };
      if (!d?.ok) throw new Error(d?.error || "Could not record your agreement");
      toast.success("Agreement signed. One more step — your deposit.");
      setSummary((s) => (s ? { ...s, agreementSigned: true } : s));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record your agreement");
    } finally {
      setSigning(false);
    }
  };

  // ── Render states ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 max-w-md mx-auto space-y-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (loadErr || !summary) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 max-w-md mx-auto">
        <SEO title="Payment link" noindex />
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900 mt-8">
          <p className="font-semibold flex items-center gap-1.5">
            <RiErrorWarningLine className="w-4 h-4" />
            {loadErr === "cancelled" ? "This booking was cancelled." : "This payment link isn't valid anymore."}
          </p>
          <p className="text-xs mt-1">
            If you believe this is a mistake, call us at{" "}
            <a href="tel:+18447352070" className="underline">(844) 735-2070</a> and we&apos;ll sort it out.
          </p>
        </div>
      </div>
    );
  }

  const paid = paidNow || summary.paid;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <SEO title="Confirm & pay your deposit — Novara Cleaning" noindex />
      <div className="max-w-md mx-auto p-4 space-y-4">
        {/* Booking summary */}
        <header className="rounded-2xl bg-gradient-to-br from-violet-600 to-purple-500 p-5 text-white shadow-md">
          <div className="flex items-center gap-2">
            <RiSparklingLine className="w-5 h-5" />
            <p className="text-sm font-semibold">
              Hi {summary.firstName || "there"} — confirm your clean
            </p>
          </div>
          <p className="mt-2 text-xs text-violet-50 leading-snug">
            NOV-{String(summary.bookingNumber || 0).padStart(5, "0")} · {serviceLabel}
            <span className="block">
              {summary.serviceDate
                ? format(new Date(`${summary.serviceDate}T12:00:00`), "EEEE, MMM d")
                : ""}
              {summary.timeSlot ? ` · ${summary.timeSlot}` : ""}
              {summary.city ? ` · ${summary.city}, ${summary.state}` : ""}
            </span>
          </p>
          <div className="mt-3 rounded-xl bg-white/15 p-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-violet-100">Total</p>
              <p className="text-sm font-bold">{money(summary.totalCents)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-violet-100">Due today</p>
              <p className="text-sm font-bold">{money(summary.depositCents)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-violet-100">After clean</p>
              <p className="text-sm font-bold">{money(summary.remainingCents)}</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-violet-100/90 leading-snug">
            The remaining {money(summary.remainingCents)} is only authorized on your card a few
            days before service and charged after we complete the clean.
          </p>
        </header>

        {paid ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-600 text-white mb-3">
              <RiCheckboxCircleLine className="w-6 h-6" />
            </div>
            <p className="font-semibold text-emerald-900">Deposit paid — you&apos;re all set!</p>
            <p className="text-xs text-emerald-800 mt-1">
              Your card is saved for the balance after the clean. A receipt is on its way to{" "}
              {summary.email || "your email"}.
            </p>
            <Button
              variant="outline"
              className="mt-3 border-emerald-300 text-emerald-800"
              onClick={goToConfirmation}
            >
              View your booking confirmation
            </Button>
          </div>
        ) : !summary.agreementSigned ? (
          /* ── STEP 1: LEGAL (required before payment unlocks) ── */
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center gap-2">
              <RiQuillPenLine className="w-4 h-4 text-violet-700" />
              <p className="text-sm font-semibold text-slate-900">Step 1 of 2 — Review &amp; sign</p>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox checked={agreeService} onCheckedChange={(v) => setAgreeService(v === true)} className="mt-0.5" />
                <span className="text-xs text-slate-700 leading-snug">
                  I have read and agree to the{" "}
                  <a href="/agreements/one-time-service-agreement.pdf" target="_blank" rel="noopener noreferrer" className="text-violet-700 underline font-medium">
                    One-Time Service Agreement
                  </a>{" "}
                  (service policy), including the deposit and post-service balance charge.
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox checked={agreeTerms} onCheckedChange={(v) => setAgreeTerms(v === true)} className="mt-0.5" />
                <span className="text-xs text-slate-700 leading-snug">
                  I agree to the{" "}
                  <a href="https://novaracleaning.com/terms" target="_blank" rel="noopener noreferrer" className="text-violet-700 underline font-medium">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="https://novaracleaning.com/refund-policy" target="_blank" rel="noopener noreferrer" className="text-violet-700 underline font-medium">
                    Refund Policy
                  </a>.
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox checked={agreeDisclaimer} onCheckedChange={(v) => setAgreeDisclaimer(v === true)} className="mt-0.5" />
                <span className="text-xs text-slate-700 leading-snug">
                  I acknowledge the{" "}
                  <a href="https://novaracleaning.com/disclaimer" target="_blank" rel="noopener noreferrer" className="text-violet-700 underline font-medium">
                    Disclaimer
                  </a>.
                </span>
              </label>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-600">Your full legal name</Label>
              <Input
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Full legal name"
                autoComplete="name"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-600">Sign below</Label>
              <div className="rounded-xl border border-slate-300 bg-slate-50/60 overflow-hidden">
                <SignaturePad onChange={setSignatureDataUrl} />
              </div>
            </div>

            <Button
              className="w-full h-12 bg-violet-600 hover:bg-violet-700 text-white font-semibold"
              disabled={!canSign || signing}
              onClick={handleSign}
            >
              {signing ? (
                <><RiLoader4Line className="w-5 h-5 mr-2 animate-spin" /> Saving your agreement…</>
              ) : (
                <><RiShieldCheckLine className="w-5 h-5 mr-2" /> Agree &amp; continue to payment</>
              )}
            </Button>
            {!allAccepted && (
              <p className="text-[11px] text-slate-400 text-center">
                All three boxes must be checked — and your signature added — before payment unlocks.
              </p>
            )}
          </div>
        ) : (
          /* ── STEP 2: PAYMENT (only reachable after the signed agreement) ── */
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RiLockLine className="w-4 h-4 text-violet-700" />
                <p className="text-sm font-semibold text-slate-900">Step 2 of 2 — Pay your deposit</p>
              </div>
              <span className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                <RiCheckboxCircleLine className="w-3.5 h-3.5" /> Agreement signed
              </span>
            </div>

            {intentLoading || !clientSecret || !stripePromise ? (
              <div className="py-10 text-center">
                <RiLoader4Line className="w-7 h-7 animate-spin text-violet-600 mx-auto mb-2" />
                <p className="text-xs text-slate-500">Preparing secure payment…</p>
              </div>
            ) : (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <StripePaymentForm
                  amount={summary.depositCents}
                  customerEmail={summary.email}
                  // 3DS redirects land straight on the confirmation page;
                  // Success.tsx accepts booking_id + payment_intent params.
                  returnUrl={`/book/confirmation?deposit=ok`}
                  bookingId={summary.bookingId}
                  onSuccess={() => {
                    toast.success("Deposit paid — thank you!");
                    goToConfirmation();
                  }}
                  onRetry={() => void startPayment()}
                />
              </Elements>
            )}
            <p className="text-[11px] text-slate-400 text-center leading-snug">
              Paying saves your card securely with Stripe so we can authorize the remaining{" "}
              {money(summary.remainingCents)} before service and charge it only after your clean is done.
            </p>
          </div>
        )}

        <p className="text-center text-[11px] text-slate-400">
          Questions? Call <a href="tel:+18447352070" className="underline">(844) 735-2070</a> — Novara Cleaning
        </p>
      </div>
    </div>
  );
}
