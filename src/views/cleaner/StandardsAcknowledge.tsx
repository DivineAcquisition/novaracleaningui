"use client";

// ─── Contractor Standards — read and acknowledge ─────────────────────────────
//
// One page, one job. Every contractor acknowledges the Standards & Conduct
// Addendum: people already working get texted this link and re-acknowledge,
// new contractors do it inside onboarding instead.
//
// Two things this page does that the ICA signing page deliberately does not:
//
//   * it shows the whole document inline rather than in a PDF frame, because
//     this is read on a phone and a pinch-to-zoom PDF is a document nobody
//     reads — and "I acknowledged it but never read it" is exactly the defence
//     the addendum exists to remove;
//   * it stays open after acknowledgment. The standards are a reference: the
//     pet rule and the chemical rule are things you want to re-read from the
//     same text message while standing in a client's kitchen.

import {
  RiCheckboxCircleFill,
  RiAlertLine,
  RiLoader4Line,
  RiShieldCheckLine,
} from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { SignaturePad } from "@/components/booking/SignaturePad";
import ContractorStandardsDocument from "@/components/cleaner/ContractorStandardsDocument";
import UrgentHireReturnLink from "@/components/cleaner/UrgentHireReturnLink";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CONTRACTOR_STANDARDS_ACKNOWLEDGMENT,
  CONTRACTOR_STANDARDS_EDITION,
  standardsAskCopy,
  type StandardsStanding,
} from "@/lib/contractor-standards";

interface StandardsPayload {
  ok: true;
  cleaner: { firstName: string; name: string; email: string };
  standing: StandardsStanding;
  acknowledgedVersion: string | null;
  acknowledgedAt: string | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: StandardsPayload }
  | { kind: "blocked"; reason: string; message: string }
  | { kind: "done"; firstName: string };

function longDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-tight text-slate-900">Novara Cleaning</p>
          <p className="text-xs text-slate-500">Contractor Standards &amp; Conduct Addendum</p>
        </div>
        {children}
        <UrgentHireReturnLink />
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

export default function StandardsAcknowledge() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [signature, setSignature] = useState<string | null>(null);
  const [legalName, setLegalName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: "blocked", reason: "invalid", message: "This link isn't valid." });
      return;
    }
    try {
      const res = await fetch(`/api/cleaner/standards/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as Partial<StandardsPayload> & {
        error?: string;
        reason?: string;
      };
      if (!res.ok || !json.ok) {
        setState({
          kind: "blocked",
          reason: json.reason || "invalid",
          message: json.error || "This link isn't valid.",
        });
        return;
      }
      const data = json as StandardsPayload;
      setState({ kind: "ready", data });
      setLegalName(data.cleaner.name);
    } catch {
      setState({
        kind: "blocked",
        reason: "network",
        message: "We couldn't load the standards. Check your connection and try again.",
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
      const res = await fetch(`/api/cleaner/standards/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureDataUrl: signature, legalName: legalName.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        firstName?: string;
      };
      if (!res.ok || !json.ok) {
        setSubmitError(json.error || "We couldn't record your acknowledgment. Please try again.");
        return;
      }
      setState({ kind: "done", firstName: json.firstName || state.data.cleaner.firstName });
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

  // ── Acknowledged, just now. The document stays on the page. ───────────────
  if (state.kind === "done") {
    return (
      <Shell>
        <Card className="text-center">
          <RiCheckboxCircleFill className="mx-auto mb-3 h-14 w-14 text-emerald-500" />
          <h1 className="text-xl font-semibold text-slate-900">
            Thank you{state.firstName ? `, ${state.firstName}` : ""}!
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Your acknowledgment is on file. Nothing else to do — and this link keeps working, so
            you can come back and re-read any of it whenever you need to.
          </p>
        </Card>
        <Card>
          <ContractorStandardsDocument />
        </Card>
      </Shell>
    );
  }

  // ── Expired, terminated, or a bad link ────────────────────────────────────
  if (state.kind === "blocked") {
    return (
      <Shell>
        <Card className="text-center">
          <RiAlertLine className="mx-auto mb-3 h-12 w-12 text-amber-500" />
          <h1 className="text-lg font-semibold text-slate-900">
            {state.reason === "expired" ? "This link has expired" : "Link not valid"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  // ── Read and acknowledge ──────────────────────────────────────────────────
  const { data } = state;
  const alreadyCurrent = data.standing === "current";
  const ask = standardsAskCopy(data.standing);
  const canSubmit = Boolean(signature) && agreed && legalName.trim().length > 1 && !submitting;

  return (
    <Shell>
      <Card>
        <h1 className="text-lg font-semibold text-slate-900">
          {alreadyCurrent
            ? "You're up to date on the standards"
            : data.cleaner.firstName
              ? `${data.cleaner.firstName}, ${ask.title.charAt(0).toLowerCase()}${ask.title.slice(1)}`
              : ask.title}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
          {alreadyCurrent
            ? `You acknowledged the current standards on ${longDate(data.acknowledgedAt)}. ` +
              "They're below any time you want to check something."
            : ask.body}
        </p>
        {!alreadyCurrent && data.standing === "outdated" && data.acknowledgedAt ? (
          <p className="mt-2 text-xs text-slate-500">
            Last acknowledged {longDate(data.acknowledgedAt)}.
          </p>
        ) : null}
      </Card>

      <Card>
        <ContractorStandardsDocument />
      </Card>

      {alreadyCurrent ? null : (
        <Card>
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Acknowledgment</h2>
              <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-400">
                {CONTRACTOR_STANDARDS_EDITION}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Your full name</Label>
              <Input
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="First and last name"
                autoComplete="name"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Signature</Label>
              <SignaturePad onChange={setSignature} />
              {!signature ? (
                <p className="text-[11px] text-slate-500">
                  Draw your signature above with your finger or mouse.
                </p>
              ) : null}
            </div>

            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
                className="mt-0.5"
              />
              <span className="text-xs leading-relaxed text-slate-700">
                {CONTRACTOR_STANDARDS_ACKNOWLEDGMENT}
              </span>
            </label>

            {submitError ? (
              <p className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{submitError}</p>
            ) : null}

            <Button className="h-12 w-full text-base" onClick={submit} disabled={!canSubmit}>
              {submitting ? (
                <>
                  <RiLoader4Line className="mr-2 h-5 w-5 animate-spin" />
                  Recording your acknowledgment…
                </>
              ) : (
                "I acknowledge these standards"
              )}
            </Button>

            <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
              <RiShieldCheckLine className="h-3.5 w-3.5" />
              This link stays open, so you can re-read the standards any time.
            </p>
          </div>
        </Card>
      )}
    </Shell>
  );
}
