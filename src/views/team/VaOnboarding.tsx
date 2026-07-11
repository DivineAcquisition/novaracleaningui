"use client";

// ─── team.novaracleaning.com — VA offer acceptance & onboarding ─────────────
//
// INVITE-DRIVEN: an admin emails a tokenized OFFER LETTER from Admin → Team;
// the link expires 30 minutes after being sent (resending mints a fresh
// window). The token carries the VA's identity, so the flow starts with the
// AGREEMENT — exactly the order required:
//
//   1. Offer + AGREEMENT — read the VA Independent Contractor Agreement
//      (existing DocuSeal template, fields pre-mapped), accept, and sign.
//   2. Onboarding form — phone, timezone, working hours, experience, tools.
//   3. Pending — the admin approval queue. NO access is provisioned until an
//      admin approves (GHL USER seat + workspace access).
//
// Visitors WITHOUT a valid invite see an invitation-required screen.

import { useEffect, useState } from "react";
import {
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiFileTextLine,
  RiLoader4Line,
  RiMailLine,
  RiQuillPenLine,
  RiShieldCheckLine,
  RiTeamLine,
  RiTimeLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { SignaturePad } from "@/components/booking/SignaturePad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { SEO } from "@/components/SEO";
import { RiDiscordFill } from "@remixicon/react";

type Step = "no-invite" | "expired" | "agreement" | "form" | "pending";

interface Session {
  id: string;
  status: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  vaRole: string;
  agreementSigned: boolean;
  agreementPreviewUrl?: string | null;
  discordInviteUrl?: string | null;
  offerNote?: string | null;
}

const STORAGE_KEY = "novara_va_onboarding_id";

const ROLE_LABELS: Record<string, string> = {
  operations: "Operations VA",
  sales: "Sales VA",
  recruiting: "Recruiting VA",
  all: "All-in-one VA",
};

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/va/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json?.error) {
    const err = new Error(json?.error || `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

// Team Discord invite card — shown once the agreement is signed.
function DiscordJoinCard({ url }: { url?: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100/70 transition-colors p-4"
    >
      <span className="w-10 h-10 rounded-xl bg-[#5865F2] flex items-center justify-center shrink-0">
        <RiDiscordFill className="w-6 h-6 text-white" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-indigo-900">Join the team Discord</span>
        <span className="block text-xs text-indigo-700/80">
          Announcements, dispatch, and day-to-day comms happen here — join now so you're ready on day one.
        </span>
      </span>
    </a>
  );
}

export default function VaOnboarding() {
  const [step, setStep] = useState<Step>("no-invite");
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(true);
  const [expiredMsg, setExpiredMsg] = useState<string | null>(null);

  // Agreement step state
  const [readAgreement, setReadAgreement] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);

  // Form step state
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("");
  const [workingHours, setWorkingHours] = useState("");
  const [experience, setExperience] = useState("");
  const [tools, setTools] = useState("");
  const [notes, setNotes] = useState("");

  const applySession = (s: Session) => {
    setSession((prev) => ({ ...(prev || s), ...s }));
    setLegalName((prev) => prev || `${s.firstName || ""} ${s.lastName || ""}`.trim());
    if (s.agreementSigned && ["invited", "started", "signed"].includes(s.status)) setStep("form");
    else if (["submitted", "approved", "rejected"].includes(s.status)) setStep("pending");
    else setStep("agreement");
  };

  // Entry: ?invite=<token> (offer email) or a saved session in this browser.
  useEffect(() => {
    const inviteToken = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("invite")
      : null;
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;

    const boot = async () => {
      if (inviteToken) {
        try {
          const s = await api<Session>({ action: "redeem", inviteToken });
          localStorage.setItem(STORAGE_KEY, s.id);
          applySession(s);
          return;
        } catch (e) {
          const err = e as Error & { status?: number };
          if (err.status === 410) {
            setExpiredMsg(err.message);
            setStep("expired");
            return;
          }
          toast.error(err.message);
        }
      }
      if (saved) {
        try {
          const s = await api<Session>({ action: "status", id: saved });
          applySession(s);
          return;
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      setStep("no-invite");
    };
    void boot().finally(() => setResuming(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sign = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const s = await api<Session>({ action: "sign", id: session.id, legalName, signatureImage: signature });
      setSession((prev) => ({ ...(prev as Session), ...s }));
      toast.success("Agreement executed — your copy is on its way to your email.");
      setStep("form");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record your signature");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const s = await api<Session>({
        action: "submit", id: session.id, phone, timezone, workingHours, experience, tools, notes,
      });
      setSession((prev) => ({ ...(prev as Session), ...s }));
      setStep("pending");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  };

  if (resuming) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RiLoader4Line className="w-8 h-8 animate-spin text-violet-600" />
      </div>
    );
  }

  const roleLabel = session ? (ROLE_LABELS[session.vaRole] || session.vaRole) : "";
  const stepIndex = step === "agreement" ? 1 : step === "form" ? 2 : 3;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 pb-16">
      <SEO title="Your offer — Novara Cleaning team onboarding" noindex />
      <div className="max-w-xl mx-auto p-4 pt-8 space-y-5">
        {/* Header / offer letter banner */}
        <header className="rounded-3xl bg-gradient-to-br from-violet-700 via-violet-600 to-purple-500 p-6 text-white shadow-xl shadow-violet-200/60">
          <div className="flex items-center gap-2.5">
            <RiTeamLine className="w-6 h-6" />
            <div>
              <p className="font-bold text-lg leading-tight">
                {session && step !== "no-invite" && step !== "expired"
                  ? `Welcome aboard, ${session.firstName || "there"}!`
                  : "Novara Cleaning — Team onboarding"}
              </p>
              <p className="text-[12px] text-violet-100/90">
                {session && step !== "no-invite" && step !== "expired"
                  ? `Your offer: ${roleLabel} · independent contractor`
                  : "Offer acceptance · agreement · approval"}
              </p>
            </div>
          </div>
          {session?.offerNote && ["agreement", "form"].includes(step) && (
            <p className="mt-3 text-[12px] text-violet-50/95 border-l-2 border-white/40 pl-3">{session.offerNote}</p>
          )}
          {["agreement", "form", "pending"].includes(step) && (
            <div className="mt-4 flex items-center gap-1.5">
              {["Sign the agreement", "Onboarding", "Approval"].map((label, i) => (
                <div key={label} className="flex-1">
                  <div className={`h-1.5 rounded-full ${i + 1 <= stepIndex ? "bg-white" : "bg-white/25"}`} />
                  <p className="text-[10px] mt-1 text-violet-100/80">{label}</p>
                </div>
              ))}
            </div>
          )}
        </header>

        {/* ── No invite ── */}
        {step === "no-invite" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-3 shadow-sm">
            <RiMailLine className="w-10 h-10 text-violet-600 mx-auto" />
            <p className="font-bold text-slate-900">Onboarding is by invitation</p>
            <p className="text-sm text-slate-500 max-w-sm mx-auto">
              VA onboarding starts from an offer-letter email sent by a Novara admin. If you're expecting one,
              check your inbox — the link inside is valid for 30 minutes. Need a fresh link? Contact your admin
              or <a className="text-violet-700 underline" href="mailto:support@novaracleaning.com">support@novaracleaning.com</a>.
            </p>
          </div>
        )}

        {/* ── Expired link ── */}
        {step === "expired" && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center space-y-3 shadow-sm">
            <RiTimeLine className="w-10 h-10 text-amber-600 mx-auto" />
            <p className="font-bold text-amber-900">This offer link has expired</p>
            <p className="text-sm text-amber-800 max-w-sm mx-auto">
              {expiredMsg || "Offer links are valid for 30 minutes after being sent."} Ask your admin to resend
              your offer — it takes them one click.
            </p>
          </div>
        )}

        {/* ── STEP 1: read + sign the agreement (FIRST) ── */}
        {step === "agreement" && session && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <RiQuillPenLine className="w-4 h-4 text-violet-700" /> Step 1 — VA Independent Contractor Agreement
            </p>
            <p className="text-xs text-slate-500 -mt-2">
              Signing as <strong>{session.email}</strong> for the <strong>{roleLabel}</strong> role.
            </p>

            {session.agreementPreviewUrl ? (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <iframe
                  title="VA Independent Contractor Agreement"
                  src={session.agreementPreviewUrl}
                  className="w-full h-[420px] bg-slate-50"
                />
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 flex items-start gap-2">
                <RiFileTextLine className="w-4 h-4 shrink-0 mt-0.5 text-violet-600" />
                The full agreement (tiered-fee, verified-scope VA Independent Contractor Agreement) will be attached to
                your signed copy by email. Review it before signing below.
              </div>
            )}

            <label className="flex items-start gap-2.5 cursor-pointer">
              <Checkbox checked={readAgreement} onCheckedChange={(v) => setReadAgreement(v === true)} className="mt-0.5" />
              <span className="text-xs text-slate-700 leading-snug">
                I have read the VA Independent Contractor Agreement in full.
              </span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <Checkbox checked={agreeTerms} onCheckedChange={(v) => setAgreeTerms(v === true)} className="mt-0.5" />
              <span className="text-xs text-slate-700 leading-snug">
                I agree to its terms — including the tiered fee structure, verified scope of work, confidentiality, and
                independent-contractor status — and I intend my electronic signature below to execute it.
              </span>
            </label>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Your full legal name *</Label>
              <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Full legal name" autoComplete="name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Sign below *</Label>
              <div className="rounded-xl border border-slate-300 bg-slate-50/60 overflow-hidden">
                <SignaturePad onChange={setSignature} />
              </div>
            </div>

            <Button
              className="w-full h-12 bg-violet-600 hover:bg-violet-700 text-white font-semibold"
              disabled={busy || !readAgreement || !agreeTerms || legalName.trim().length < 3 || !signature}
              onClick={sign}
            >
              {busy ? (
                <><RiLoader4Line className="w-5 h-5 animate-spin mr-2" /> Executing agreement…</>
              ) : (
                <><RiShieldCheckLine className="w-5 h-5 mr-2" /> Accept offer & sign the agreement</>
              )}
            </Button>
            <p className="text-[11px] text-slate-400 text-center">
              Your signature and timestamp are recorded, and you'll receive your executed copy by email.
              No access is granted until an admin approves your onboarding.
            </p>
          </div>
        )}

        {/* ── STEP 2: onboarding form (only after signing) ── */}
        {step === "form" && session && <DiscordJoinCard url={session.discordInviteUrl} />}
        {step === "form" && session && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <RiTimeLine className="w-4 h-4 text-violet-700" /> Step 2 — Onboarding details
              </p>
              <span className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                <RiCheckboxCircleLine className="w-3.5 h-3.5" /> Agreement signed
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-slate-600">Phone (WhatsApp ok)</Label>
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" />
              </div>
              <div>
                <Label className="text-xs text-slate-600">Time zone *</Label>
                <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. GMT+8 / Manila" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-600">Working hours (ET) *</Label>
              <Input value={workingHours} onChange={(e) => setWorkingHours(e.target.value)} placeholder="e.g. 9am–5pm ET Mon–Fri" />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Relevant experience</Label>
              <Textarea rows={3} value={experience} onChange={(e) => setExperience(e.target.value)}
                placeholder="CRMs you've worked, cold calling / SMS experience, dispatch or scheduling background…" />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Tools you know</Label>
              <Input value={tools} onChange={(e) => setTools(e.target.value)} placeholder="GoHighLevel, Slack, Google Sheets…" />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Anything else</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>

            <Button
              className="w-full h-12 bg-violet-600 hover:bg-violet-700 text-white font-semibold"
              disabled={busy || !timezone.trim() || !workingHours.trim()}
              onClick={submit}
            >
              {busy ? <RiLoader4Line className="w-5 h-5 animate-spin mr-2" /> : null}
              Submit for approval
            </Button>
          </div>
        )}

        {/* ── STEP 3: pending / outcome ── */}
        {step === "pending" && session && (
          <div className={`rounded-2xl border p-6 text-center space-y-2 shadow-sm ${
            session.status === "approved"
              ? "border-emerald-200 bg-emerald-50"
              : session.status === "rejected"
                ? "border-rose-200 bg-rose-50"
                : "border-violet-200 bg-violet-50/60"
          }`}>
            {session.status === "approved" ? (
              <>
                <RiCheckboxCircleLine className="w-10 h-10 text-emerald-600 mx-auto" />
                <p className="font-bold text-emerald-900">You're approved and active!</p>
                <p className="text-xs text-emerald-800">
                  Check {session.email} for your CRM login and workspace invite. Welcome to the team.
                </p>
              </>
            ) : session.status === "rejected" ? (
              <>
                <RiErrorWarningLine className="w-10 h-10 text-rose-500 mx-auto" />
                <p className="font-bold text-rose-900">Your application wasn't approved this time.</p>
                <p className="text-xs text-rose-800">Questions? Email support@novaracleaning.com.</p>
              </>
            ) : (
              <>
                <RiLoader4Line className="w-10 h-10 text-violet-600 mx-auto animate-spin" />
                <p className="font-bold text-violet-900">You're in the approval queue</p>
                <p className="text-xs text-violet-800 max-w-sm mx-auto">
                  Your agreement is signed and your onboarding is submitted. An admin reviews every application —
                  once approved, your CRM login ({session.email}) and workspace access are created and emailed to you.
                  Nothing is provisioned before that approval.
                </p>
              </>
            )}
          </div>
        )}

        {step === "pending" && session && session.status !== "rejected" && (
          <DiscordJoinCard url={session.discordInviteUrl} />
        )}

        <p className="text-center text-[11px] text-slate-400">
          Novara Cleaning · team.novaracleaning.com · questions? support@novaracleaning.com
        </p>
      </div>
    </div>
  );
}
