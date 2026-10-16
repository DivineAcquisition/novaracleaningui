"use client";

import { useEffect, useState } from "react";
import { RiArrowRightLine, RiBankCardLine, RiLoader4Line } from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  RECOMMENDED_LABEL,
  activeAcknowledgment,
  confirmationPreview,
  defaultPayoutSettings,
  methodOneLine,
  methodsForChoice,
  type PayoutMethodDefinition,
  type PayoutSettings,
} from "@/lib/payout-methods";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.session?.access_token || ""}`,
  };
}

type Stage = "choose" | "details" | "confirm" | "code" | "done";

export default function PayoutMethodStep({
  stripeLoading,
  onStripe,
  onVerified,
}: {
  stripeLoading: boolean;
  onStripe: () => void;
  onVerified?: () => void;
}) {
  const [settings, setSettings] = useState<PayoutSettings>(defaultPayoutSettings());
  const [stage, setStage] = useState<Stage>("choose");
  const [method, setMethod] = useState<PayoutMethodDefinition | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [identifierAgain, setIdentifierAgain] = useState("");
  const [accountName, setAccountName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ identifier: string; accountName: string; expect: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cleaner/payout-method", { headers: await authHeaders() });
        const body = await res.json().catch(() => ({}));
        if (cancelled || !body?.settings?.methods) return;
        setSettings(body.settings);
        if (body.profile?.status === "verified") setStage("done");
        if (body.profile?.changePending) setStage("code");
      } catch {
        /* defaults stay on screen */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const methods = methodsForChoice(settings);
  const ack = activeAcknowledgment(settings);

  const choose = (next: PayoutMethodDefinition) => {
    setError("");
    setMethod(next);
    setIdentifier("");
    setIdentifierAgain("");
    setAccountName("");
    setAcknowledged(false);
    setPreview(null);
    setStage(next.kind === "stripe" ? "choose" : "details");
  };

  const review = () => {
    if (!method) return;
    setError("");
    if (identifier.trim() !== identifierAgain.trim()) {
      setError("The two identifiers don't match. Enter the same one twice.");
      return;
    }
    const next = confirmationPreview({ method, identifier, accountName, settings });
    setPreview(next);
    setAcknowledged(false);
    setStage("confirm");
  };

  const submit = async () => {
    if (!method || !preview) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cleaner/payout-method", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          action: "submit",
          methodCode: method.code,
          identifier,
          identifierAgain,
          accountName,
          acknowledged,
          acknowledgmentText: ack.text,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setError(body.error || "Couldn't save those details.");
        return;
      }
      setStage("code");
    } catch {
      setError("Couldn't save those details.");
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cleaner/payout-method", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ action: "confirm_code", code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setError(body.error || "That code didn't work.");
        return;
      }
      setStage("done");
      onVerified?.();
    } catch {
      setError("That code didn't work.");
    } finally {
      setBusy(false);
    }
  };

  if (stage === "done") {
    return (
      <p className="text-sm text-muted-foreground">
        Payout details confirmed. Completed-job pay uses this method. You can change it from your profile.
      </p>
    );
  }

  if (stage === "code") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          We sent a code to the email or phone already on your profile. Enter it to confirm. The new details stay pending until you do.
        </p>
        <Label htmlFor="payout-code">Confirmation code</Label>
        <Input id="payout-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="button" onClick={() => void confirmCode()} disabled={busy || code.trim().length < 6}>
          {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : null}
          Confirm code
        </Button>
      </div>
    );
  }

  if (stage === "confirm" && method && preview) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">Check this before you confirm</p>
        <dl className="text-sm space-y-1">
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Method</dt><dd>{method.displayName}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{method.identifierLabel}</dt><dd>{preview.identifier}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Name on the account</dt><dd>{preview.accountName}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">What to expect</dt><dd className="text-right">{preview.expect}</dd></div>
        </dl>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox id="payout-ack" checked={acknowledged} onCheckedChange={(value) => setAcknowledged(value === true)} />
          <span>{ack.text}</span>
        </label>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setStage("details")}>Back</Button>
          <Button type="button" onClick={() => void submit()} disabled={busy || !acknowledged}>
            {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Save and send code
          </Button>
        </div>
      </div>
    );
  }

  if (stage === "details" && method) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{method.instructions}</p>
        <div className="space-y-1">
          <Label htmlFor="payout-id">{method.identifierLabel}</Label>
          <Input id="payout-id" autoComplete="off" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="payout-id-again">Enter it again</Label>
          <Input id="payout-id-again" autoComplete="off" value={identifierAgain} onChange={(e) => setIdentifierAgain(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="payout-name">Name exactly as it appears on that account</Label>
          <Input id="payout-name" autoComplete="name" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setStage("choose")}>Back</Button>
          <Button type="button" onClick={review}>Review</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Pick one. You can change it later from your profile.</p>
      <ul className="space-y-2">
        {methods.map((item) => (
          <li key={item.code} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{item.displayName}</p>
              {item.code === "stripe" ? (
                <span className="text-xs font-medium text-primary">{RECOMMENDED_LABEL}</span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">{methodOneLine(item, settings)}</p>
            {item.kind === "stripe" ? (
              <Button type="button" onClick={onStripe} disabled={stripeLoading}>
                {stripeLoading ? (
                  <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <RiBankCardLine className="w-4 h-4 mr-1.5" />
                )}
                Set up Stripe payouts
                <RiArrowRightLine className="w-4 h-4 ml-1.5" />
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => choose(item)}>
                Use {item.displayName}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
