"use client";

import { PaymentElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { useState } from "react";
import { RiBankCardLine, RiLoader4Line } from "@remixicon/react";

import { getStripePromise } from "@/lib/stripe-client";

/**
 * In-page card-on-file form for a Stripe SetupIntent.
 *
 * The sibling EmbeddedCardForm confirms a manual-capture PaymentIntent, which
 * is the right shape when a hold is being placed. This one stores a card to
 * be charged later — no amount, nothing authorized now — so it confirms a
 * SetupIntent instead. Neither redirects to Stripe Checkout.
 */
export function EmbeddedSetupForm({
  clientSecret,
  returnUrl,
  submitLabel,
  note,
  onConfirmed,
}: {
  clientSecret: string;
  returnUrl: string;
  submitLabel: string;
  note?: string;
  onConfirmed: (setupIntentId: string) => void | Promise<void>;
}) {
  return (
    <Elements
      stripe={getStripePromise()}
      options={{
        clientSecret,
        appearance: { theme: "stripe", variables: { colorPrimary: "#5C0FFE" } },
      }}
    >
      <SetupFormInner
        returnUrl={returnUrl}
        submitLabel={submitLabel}
        note={note}
        onConfirmed={onConfirmed}
      />
    </Elements>
  );
}

function SetupFormInner({
  returnUrl,
  submitLabel,
  note,
  onConfirmed,
}: {
  returnUrl: string;
  submitLabel: string;
  note?: string;
  onConfirmed: (setupIntentId: string) => void | Promise<void>;
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
      const result = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });
      if (result.error) {
        setError(result.error.message || "That card could not be saved. Try another.");
        return;
      }
      const intent = result.setupIntent;
      const status = String(intent?.status || "");
      if (intent?.id && (status === "succeeded" || status === "processing")) {
        await onConfirmed(intent.id);
        return;
      }
      setError("The card did not finish saving. Please try again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the card.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {note && <p className="text-sm leading-relaxed text-slate-600">{note}</p>}
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy || !stripe || !elements}
        onClick={() => void submit()}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
      >
        {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiBankCardLine className="h-4 w-4" />}
        {busy ? "Saving…" : submitLabel}
      </button>
      <p className="text-center text-xs text-slate-400">
        Card form stays on this page. We never see the full card number.
      </p>
    </div>
  );
}
