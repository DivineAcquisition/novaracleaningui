"use client";

import { PaymentElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import type { ReactNode } from "react";
import { useState } from "react";
import { RiBankCardLine, RiLoader4Line } from "@remixicon/react";

import { getStripePromise } from "@/lib/stripe-client";
import { money } from "@/lib/commercial-proposal";

export type EmbeddedCardMode = "hold" | "setup";

function resolveCardMode(clientSecret: string, mode?: EmbeddedCardMode): EmbeddedCardMode {
  if (mode) return mode;
  return clientSecret.startsWith("seti_") ? "setup" : "hold";
}

/**
 * In-page card form for onboarding and portal card-on-file.
 * Hold mode confirms a manual-capture PaymentIntent (Pre-Auth).
 * Setup mode confirms a SetupIntent — card on file, nothing held.
 * 3DS only leaves the page if required.
 */
export function EmbeddedCardForm({
  clientSecret,
  returnUrl,
  amountCents,
  submitLabel,
  mode,
  description,
  onConfirmed,
}: {
  clientSecret: string;
  returnUrl: string;
  amountCents: number;
  submitLabel: string;
  mode?: EmbeddedCardMode;
  description?: ReactNode;
  onConfirmed: (paymentIntentId: string) => void | Promise<void>;
}) {
  const resolvedMode = resolveCardMode(clientSecret, mode);
  return (
    <Elements
      stripe={getStripePromise()}
      options={{
        clientSecret,
        appearance: { theme: "stripe", variables: { colorPrimary: "#5C0FFE" } },
      }}
    >
      <CardFormInner
        mode={resolvedMode}
        returnUrl={returnUrl}
        amountCents={amountCents}
        submitLabel={submitLabel}
        description={description}
        onConfirmed={onConfirmed}
      />
    </Elements>
  );
}

function CardFormInner({
  mode,
  returnUrl,
  amountCents,
  submitLabel,
  description,
  onConfirmed,
}: {
  mode: EmbeddedCardMode;
  returnUrl: string;
  amountCents: number;
  submitLabel: string;
  description?: ReactNode;
  onConfirmed: (paymentIntentId: string) => void | Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSetup = mode === "setup";

  const submit = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      if (isSetup) {
        const result = await stripe.confirmSetup({
          elements,
          confirmParams: { return_url: returnUrl },
          redirect: "if_required",
        });
        if (result.error) {
          setError(result.error.message || "That card could not be saved. Try another.");
          return;
        }
        const setup = result.setupIntent;
        if (setup?.id && String(setup.status || "") === "succeeded") {
          await onConfirmed(setup.id);
          return;
        }
        setError("The card was not saved. Please try again.");
        return;
      }

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

  const defaultCopy = isSetup ? (
    <p className="text-sm leading-relaxed text-slate-600">
      Save this card on file. <strong>Nothing is held or charged now.</strong> There is no
      Pre-Auth hold for this option.
    </p>
  ) : (
    <p className="text-sm leading-relaxed text-slate-600">
      This places a <strong>Stripe Pre-Auth hold of {money(amountCents)}</strong> to verify the
      card. Nothing is captured now — the hold expires if it is not used for a visit.
    </p>
  );

  return (
    <div className="space-y-3">
      {description ?? defaultCopy}
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
        {busy ? (isSetup ? "Saving…" : "Authorizing…") : submitLabel}
      </button>
      <p className="text-center text-xs text-slate-400">
        Card form stays on this page. We never see the full card number.
      </p>
    </div>
  );
}
