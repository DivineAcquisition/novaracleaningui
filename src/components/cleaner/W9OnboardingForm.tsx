"use client";

// The recipient block a 1099-NEC cannot be filed without: legal name, TIN
// type, TIN, and a street address. Stored on cleaner_w9 by the nec-1099
// function. The response comes back with the last four digits only.

import { RiLoader4Line } from "@remixicon/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { describeEdgeError } from "@/lib/edge-invoke";
import { validateRecipient } from "@/lib/nec-1099";
import { US_STATES, postalStateCode } from "@/lib/us-states";
import { w9FieldErrors } from "@/lib/w9-onboarding";

type TinType = "ssn" | "ein" | "itin";

type Summary = {
  legalName: string;
  tinLast4: string;
  street: string;
  city: string;
  state: string;
  zip: string;
};

const TIN_LABEL: Record<TinType, string> = {
  ssn: "Social Security number",
  ein: "Employer identification number",
  itin: "Individual taxpayer identification number",
};

export function W9OnboardingForm({
  firstName,
  lastName,
  street: streetDefault,
  city: cityDefault,
  state: stateDefault,
  zip: zipDefault,
  done,
  onSubmitted,
  onFile = null,
  saveW9,
}: {
  firstName: string;
  lastName: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  done: boolean;
  onSubmitted: () => Promise<void>;
  /** Already-filed summary for a page that does not call the signed-in function. */
  onFile?: Summary | null;
  /**
   * When set, this page saves here instead of nec-1099. Used by the
   * tokenized link, which has no contractor login.
   */
  saveW9?: (input: {
    legalName: string;
    tinType: TinType;
    tin: string;
    street: string;
    city: string;
    state: string;
    zip: string;
  }) => Promise<Summary>;
}) {
  const [legalName, setLegalName] = useState(`${firstName} ${lastName}`.trim());
  const [tinType, setTinType] = useState<TinType>("ssn");
  const [tin, setTin] = useState("");
  const [street, setStreet] = useState(streetDefault);
  const [city, setCity] = useState(cityDefault);
  const [state, setState] = useState(() => postalStateCode(stateDefault));
  const [zip, setZip] = useState(zipDefault);
  const [certified, setCertified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [editing, setEditing] = useState(!done);
  const [summary, setSummary] = useState<Summary | null>(onFile);

  useEffect(() => {
    if (saveW9 || !done) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.functions.invoke("nec-1099", {
        body: { action: "w9_summary" },
      });
      const row = data as Partial<Summary> & { onFile?: boolean; legalName?: string } | null;
      if (cancelled || !row?.onFile) return;
      setSummary({
        legalName: String(row.legalName || ""),
        tinLast4: String(row.tinLast4 || ""),
        street: String(row.street || ""),
        city: String(row.city || ""),
        state: String(row.state || ""),
        zip: String(row.zip || ""),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [done, saveW9]);

  const beginUpdate = () => {
    if (summary?.legalName) setLegalName(summary.legalName);
    if (summary?.street) setStreet(summary.street);
    if (summary?.city) setCity(summary.city);
    if (summary?.state) setState(postalStateCode(summary.state));
    if (summary?.zip) setZip(summary.zip);
    setTin("");
    setCertified(false);
    setErrors([]);
    setEditing(true);
  };

  const submit = async () => {
    const stateCode = postalStateCode(state);
    const fieldErrors = w9FieldErrors({
      legalName,
      tinType,
      tin,
      street,
      city,
      state: stateCode,
      zip,
    });
    if (fieldErrors.length > 0) {
      setErrors(fieldErrors);
      return;
    }
    const checked = validateRecipient({
      name: legalName,
      tinType,
      tin,
      street,
      city,
      state: stateCode,
      zip,
    });
    if (checked.ok === false) {
      setErrors(["Check the name, address, and taxpayer identification number, then try again."]);
      return;
    }
    if (!certified) return;
    setSaving(true);
    setErrors([]);
    try {
      if (saveW9) {
        const saved = await saveW9({
          legalName: checked.recipient.name,
          tinType: checked.recipient.tinType,
          tin: checked.recipient.tin,
          street: checked.recipient.street,
          city: checked.recipient.city,
          state: checked.recipient.state,
          zip: checked.recipient.zip,
        });
        await onSubmitted();
        setSummary(saved);
        setTin("");
        setCertified(false);
        setEditing(false);
        return;
      }
      const { data, error: invokeError } = await supabase.functions.invoke("nec-1099", {
        body: {
          action: "submit_w9",
          certified: true,
          legalName: checked.recipient.name,
          tinType: checked.recipient.tinType,
          tin: checked.recipient.tin,
          street: checked.recipient.street,
          city: checked.recipient.city,
          state: checked.recipient.state,
          zip: checked.recipient.zip,
        },
      });
      const saved = data as { ok?: boolean; legalName?: string; tinLast4?: string; error?: string } | null;
      if (invokeError || !saved?.ok) {
        throw new Error(await describeEdgeError(invokeError, saved));
      }
      await onSubmitted();
      setSummary({
        legalName: String(saved.legalName || checked.recipient.name),
        tinLast4: String(saved.tinLast4 || ""),
        street: checked.recipient.street,
        city: checked.recipient.city,
        state: checked.recipient.state,
        zip: checked.recipient.zip,
      });
      setTin("");
      setCertified(false);
      setEditing(false);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Couldn't save the W-9."]);
    } finally {
      setSaving(false);
    }
  };

  if (!editing && (done || summary)) {
    const last4 = summary?.tinLast4 ? `ending in ${summary.tinLast4}` : "";
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          W-9 on file
          {summary?.legalName ? (
            <>
              {" "}
              as <span className="font-medium text-foreground">{summary.legalName}</span>
            </>
          ) : null}
          {last4 ? <span> · TIN {last4}</span> : "."}
        </p>
        <Button type="button" variant="outline" onClick={beginUpdate}>
          Update W-9
        </Button>
      </div>
    );
  }

  const canSubmit = certified && !saving;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        This is the name, taxpayer identification number, and address that go on a 1099.
        Use the name on your tax return.
      </p>
      <div>
        <Label htmlFor="w9-legal-name" className="text-xs">Name on your tax return</Label>
        <Input
          id="w9-legal-name"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          autoComplete="name"
        />
      </div>
      <div>
        <Label htmlFor="w9-tin-type" className="text-xs">Identification type</Label>
        <select
          id="w9-tin-type"
          value={tinType}
          onChange={(e) => setTinType(e.target.value as TinType)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {(Object.keys(TIN_LABEL) as TinType[]).map((key) => (
            <option key={key} value={key}>{TIN_LABEL[key]}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="w9-tin" className="text-xs">Taxpayer identification number</Label>
        <Input
          id="w9-tin"
          value={tin}
          onChange={(e) => setTin(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          placeholder="9 digits"
        />
      </div>
      <div>
        <Label htmlFor="w9-street" className="text-xs">Street</Label>
        <Input id="w9-street" value={street} onChange={(e) => setStreet(e.target.value)} autoComplete="street-address" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <Label htmlFor="w9-city" className="text-xs">City</Label>
          <Input id="w9-city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
        </div>
        <div>
          <Label htmlFor="w9-state" className="text-xs">State</Label>
          <select
            id="w9-state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            autoComplete="address-level1"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Select</option>
            {US_STATES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.value} — {entry.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="w9-zip" className="text-xs">ZIP</Label>
          <Input id="w9-zip" value={zip} onChange={(e) => setZip(e.target.value)} autoComplete="postal-code" inputMode="numeric" placeholder="20814" />
        </div>
      </div>
      <div className="flex items-start gap-2.5">
        <Checkbox
          id="w9-certify"
          checked={certified}
          onCheckedChange={(v) => setCertified(v === true)}
          className="mt-0.5"
        />
        <label htmlFor="w9-certify" className="cursor-pointer text-sm text-foreground">
          I certify this name, address, and taxpayer identification number are correct.
        </label>
      </div>
      {errors.length > 0 ? (
        <ul className="space-y-1 text-sm text-rose-600">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
      <Button type="button" className="w-full" disabled={!canSubmit} onClick={() => void submit()}>
        {saving ? (
          <>
            <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
            Saving…
          </>
        ) : (
          "Submit W-9"
        )}
      </Button>
    </div>
  );
}
