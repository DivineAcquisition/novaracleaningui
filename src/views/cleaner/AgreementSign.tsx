"use client";

// ─── Contractor agreement — one page, one job ─────────────────────────────────
//
// For contractors who are already working but never signed an ICA. They get a
// text, tap it, read the agreement, sign, and they're done. No account, no
// five-step wizard, no dashboard afterwards.
//
// That restraint is the whole design. The reason these agreements are unsigned
// is that the existing path asks for a login and four unrelated steps first, and
// people abandon it. So this page shows exactly one action at a time and ends
// with a thank-you rather than a "next step".

import {
  RiAlertLine,
  RiCheckboxCircleFill,
  RiFileTextLine,
  RiLoader4Line,
  RiShieldCheckLine,
} from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { SignaturePad } from "@/components/booking/SignaturePad";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface AgreementPayload {
  ok: true;
  cleaner: {
    firstName: string;
    lastName: string;
    name: string;
    email: string;
    phone: string;
    address: string;
  };
  previewUrl: string | null;
  expiresAt: string | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: AgreementPayload }
  | { kind: "blocked"; reason: string; message: string }
  | { kind: "done"; firstName: string; email: string };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-tight text-slate-900">Novara Cleaning</p>
          <p className="text-xs text-slate-500">Independent Contractor Agreement</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className || ""}`}>
      {children}
    </div>
  );
}

export default function AgreementSign() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [signature, setSignature] = useState<string | null>(null);
  const [legalName, setLegalName] = useState("");
  const [address, setAddress] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: "blocked", reason: "invalid", message: "This signing link isn't valid." });
      return;
    }
    try {
      const res = await fetch(`/api/cleaner/agreement/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as Partial<AgreementPayload> & {
        error?: string;
        reason?: string;
      };
      if (!res.ok || !json.ok) {
        setState({
          kind: "blocked",
          reason: json.reason || "invalid",
          message: json.error || "This signing link isn't valid.",
        });
        return;
      }
      const data = json as AgreementPayload;
      setState({ kind: "ready", data });
      setLegalName(data.cleaner.name);
      setAddress(data.cleaner.address);
    } catch {
      setState({
        kind: "blocked",
        reason: "network",
        message: "We couldn't load your agreement. Check your connection and try again.",
      });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (state.kind !== "ready") return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/cleaner/agreement/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signatureDataUrl: signature,
          legalName: legalName.trim(),
          address: address.trim(),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        firstName?: string;
        email?: string;
      };
      if (!res.ok || !json.ok) {
        setSubmitError(json.error || "We couldn't file your agreement. Please try again.");
        return;
      }
      setState({
        kind: "done",
        firstName: json.firstName || state.data.cleaner.firstName,
        email: json.email || state.data.cleaner.email,
      });
    } catch {
      setSubmitError("We couldn't reach our servers. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (state.kind === "loading") {
    return (
      <Shell>
        <Card>
          <Skeleton className="mb-3 h-5 w-2/3" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </Card>
      </Shell>
    );
  }

  // ── Thank you. The end of the road, on purpose. ─────────────────────────────
  if (state.kind === "done") {
    return (
      <Shell>
        <Card className="text-center">
          <RiCheckboxCircleFill className="mx-auto mb-3 h-14 w-14 text-emerald-500" />
          <h1 className="text-xl font-semibold text-slate-900">
            Thank you{state.firstName ? `, ${state.firstName}` : ""}!
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Your contractor agreement is signed and on file. A copy is on its way to
            {state.email ? ` ${state.email}` : " your email"} for your records.
          </p>
          <p className="mt-4 text-xs text-slate-500">
            That&apos;s everything we needed — nothing else to do here.
          </p>
        </Card>
      </Shell>
    );
  }

  // ── Can't sign: expired, already signed, or a bad link ─────────────────────
  if (state.kind === "blocked") {
    const friendly = state.reason === "already_signed";
    return (
      <Shell>
        <Card className="text-center">
          {friendly ? (
            <RiCheckboxCircleFill className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
          ) : (
            <RiAlertLine className="mx-auto mb-3 h-12 w-12 text-amber-500" />
          )}
          <h1 className="text-lg font-semibold text-slate-900">
            {friendly ? "You're all set" : state.reason === "expired" ? "This link has expired" : "Link not valid"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  // ── Sign ───────────────────────────────────────────────────────────────────
  const { data } = state;
  const canSubmit = Boolean(signature) && agreed && legalName.trim().length > 1 && !submitting;

  return (
    <Shell>
      <Card>
        <h1 className="text-lg font-semibold text-slate-900">
          {data.cleaner.firstName ? `${data.cleaner.firstName}, please sign your agreement` : "Please sign your agreement"}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
          This is the Independent Contractor Agreement between you and Novara Cleaning. Read it, sign
          below, and you&apos;re done — this is the only thing we need from you here.
        </p>
      </Card>

      {/* Read it before signing it. Non-negotiable, so it's not behind a link. */}
      <Card>
        <div className="mb-2 flex items-center gap-2">
          <RiFileTextLine className="h-4 w-4 text-slate-500" />
          <p className="text-sm font-medium text-slate-900">The agreement</p>
        </div>
        {data.previewUrl ? (
          <>
            <iframe
              src={data.previewUrl}
              title="Independent Contractor Agreement"
              className="h-[420px] w-full rounded-lg border border-slate-200 bg-slate-50"
            />
            <a
              href={data.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs font-medium text-indigo-700 underline"
            >
              Open in a new tab
            </a>
          </>
        ) : (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            We couldn&apos;t load the document preview right now. You can still sign — the full signed
            copy will be emailed to you — or come back to this link in a few minutes to read it first.
          </p>
        )}
      </Card>

      <Card>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Your full legal name</Label>
            <Input
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="First and last name"
              autoComplete="name"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Mailing address <span className="font-normal text-slate-400">(optional)</span>
            </Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, city, state ZIP"
              autoComplete="street-address"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Signature</Label>
            <SignaturePad onChange={setSignature} />
            {!signature ? (
              <p className="text-[11px] text-slate-500">Draw your signature above with your finger or mouse.</p>
            ) : null}
          </div>

          <label className="flex cursor-pointer items-start gap-2.5">
            <Checkbox
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
            />
            <span className="text-xs leading-relaxed text-slate-700">
              I have read the Independent Contractor Agreement and I agree to it. I understand this
              electronic signature is legally binding, and that I am an independent contractor — not
              an employee.
            </span>
          </label>

          {submitError ? (
            <p className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{submitError}</p>
          ) : null}

          <Button className="h-12 w-full text-base" onClick={submit} disabled={!canSubmit}>
            {submitting ? (
              <>
                <RiLoader4Line className="mr-2 h-5 w-5 animate-spin" />
                Filing your agreement…
              </>
            ) : (
              "Sign and finish"
            )}
          </Button>

          <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
            <RiShieldCheckLine className="h-3.5 w-3.5" />
            A signed copy is emailed to you automatically.
          </p>
        </div>
      </Card>
    </Shell>
  );
}
