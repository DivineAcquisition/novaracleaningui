"use client";

// Independent Contractor Agreement, signed inside the onboarding portal.
// Uses the same /api/cleaner/sign-agreement path the profile wizard uses, so
// DocuSeal still emails them the finished copy and the cleaner row gets
// ob_agreement_signed either way.

import {
  RiCheckboxCircleFill,
  RiLoader4Line,
} from "@remixicon/react";
import { useState } from "react";

import { SignaturePad } from "@/components/booking/SignaturePad";
import { AgreementPdfPreview } from "@/components/cleaner/AgreementPdfPreview";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export interface PortalAgreementFormProps {
  firstName: string;
  lastName: string;
  phone: string | null;
  address: string;
  signedAt: string | null;
  onSigned: () => Promise<void>;
}

export function PortalAgreementForm({
  firstName,
  lastName,
  phone,
  address,
  signedAt,
  onSigned,
}: PortalAgreementFormProps) {
  const defaultName = `${firstName} ${lastName}`.trim();
  const [legalName, setLegalName] = useState(defaultName);
  const [signature, setSignature] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState<string | null>(signedAt);

  const authHeaders = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const submit = async () => {
    if (!signature || !agreed || legalName.trim().length < 2) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/cleaner/sign-agreement", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          firstName,
          lastName,
          phone: phone || undefined,
          address: address || undefined,
          legalName: legalName.trim(),
          signatureDataUrl: signature,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Couldn't file the agreement. Try again.");
      }
      await onSigned();
      setSigned(new Date().toISOString());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (signed) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
        <RiCheckboxCircleFill className="h-4 w-4" />
        Signed{signedAt ? ` · ${new Date(signedAt).toLocaleDateString()}` : ""}. A copy is on its way
        to your email.
      </p>
    );
  }

  const canSubmit =
    Boolean(signature) && agreed && legalName.trim().length > 1 && !saving;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        This is the Independent Contractor Agreement between you and Novara Cleaning.
        Read it, sign below, and a completed copy is emailed to you.
      </p>
      <AgreementPdfPreview />
      <div>
        <Label className="text-xs">Legal name</Label>
        <Input
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          placeholder={defaultName || "Your legal name"}
        />
      </div>
      <div>
        <Label className="text-xs">Signature</Label>
        <SignaturePad onChange={setSignature} />
      </div>
      <label className="flex items-start gap-2.5 text-sm text-foreground cursor-pointer">
        <Checkbox
          checked={agreed}
          onCheckedChange={(v) => setAgreed(v === true)}
          className="mt-0.5"
        />
        <span>I have read the Independent Contractor Agreement and I agree to it.</span>
      </label>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      <Button className="w-full" disabled={!canSubmit} onClick={() => void submit()}>
        {saving ? (
          <>
            <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
            Filing…
          </>
        ) : (
          "Sign agreement"
        )}
      </Button>
    </div>
  );
}
