"use client";

import { PaymentElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { useState } from "react";
import { RiBankCardLine, RiLoader4Line } from "@remixicon/react";

import { getStripePromise } from "@/lib/stripe-client";
import { money } from "@/lib/commercial-proposal";

/**
 * In-page card form for onboarding and portal card-on-file.
 * Never redirects to Stripe Checkout. A manual-capture PaymentIntent
 * (pre-auth hold) is confirmed here; 3DS only leaves the page if required.
 */
export function EmbeddedCardForm({
  clientSecret,
  returnUrl,
  amountCents,
  submitLabel,
  onConfirmed,
}: {
  clientSecret: string;
  returnUrl: string;
  amountCents: number;
  submitLabel: string;
  onConfirmed: (paymentIntentId: string) => void | Promise<void>;
}) {
  return (
    <Elements
      stripe={getStripePromise()}
      options={{
        clientSecret,
        appearance: { theme: "stripe", variables: { colorPrimary: "#5C0FFE" } },
      }}
    >
      <CardFormInner
        returnUrl={returnUrl}
        amountCents={amountCents}
        submitLabel={submitLabel}
        onConfirmed={onConfirmed}
      />
    </Elements>
  );
}

function CardFormInner({
  returnUrl,
  amountCents,
  submitLabel,
  onConfirmed,
}: {
  returnUrl: string;
  amountCents: number;
  submitLabel: string;
  onConfirmed: (paymentIntentId: string) => void | Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });
      if (result.error) {
        setError(result.error.message || "That card could not be authorized. Try another.");
        return;
      }
      const pi = result.paymentIntent;
      const status = String(pi?.status || "");
      if (
        pi?.id &&
        (status === "requires_capture" || status === "succeeded" || status === "processing")
      ) {
        await onConfirmed(pi.id);
        return;
      }
      setError("The hold did not finish. Please try the card again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the card.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-slate-600">
        This places a <strong>Stripe Pre-Auth hold of {money(amountCents)}</strong> to verify the
        card. Nothing is captured now — the hold expires if it is not used for a visit.
      </p>
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}
      <button
        type="button"
        disabled={busy || !stripe || !elements}
        onClick={() => void submit()}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
      >
        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiBankCardLine className="h-4 w-4" />}
        {busy ? "Authorizing…" : submitLabel}
      </button>
      <p className="text-center text-xs text-slate-400">
        Card form stays on this page. We never see the full card number.
      </p>
    </div>
  );
}
