"use client";

// ─── team.novaracleaning.com — VA onboarding & agreement signing ────────────
//
// The full VA intake flow, gated in the required order:
//
//   1. Who you are — name, email (the identity key everywhere), phone, role.
//   2. READ + SIGN the VA Independent Contractor Agreement (existing DocuSeal
//      template; fields pre-mapped server-side; the drawn signature renders in
//      the executed document and the VA is emailed their completed copy).
//   3. Onboarding form — timezone, working hours, experience, tools. Only
//      unlocks AFTER the agreement is signed.
//   4. Pending screen — "you're in the approval queue." NO access exists until
//      an admin approves in the workspace (which provisions the GHL USER seat
//      + internal workspace access).

import { useEffect, useState } from "react";
import {
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiFileTextLine,
  RiLoader4Line,
  RiQuillPenLine,
  RiShieldCheckLine,
  RiTeamLine,
  RiTimeLine,
  RiUser3Line,
} from "@remixicon/react";
import { toast } from "sonner";
import { SignaturePad } from "@/components/booking/SignaturePad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEO } from "@/components/SEO";
import { RiDiscordFill } from "@remixicon/react";

type Step = "identity" | "agreement" | "form" | "pending";

// Team Discord invite card — shown once the agreement is signed (form +
// pending steps). Renders only when DISCORD_INVITE_URL is configured.
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
}

const STORAGE_KEY = "novara_va_onboarding_id";

const VA_ROLES = [
  { id: "operations", label: "Operations VA", hint: "Conversations, bookings, calendars, dispatch pipeline" },
  { id: "sales", label: "Sales VA", hint: "Sales pipeline, outreach, contact tools" },
  { id: "recruiting", label: "Recruiting VA", hint: "Recruiting pipeline & applicant records" },
  { id: "all", label: "All-in-one VA", hint: "Operations + sales + recruiting (still not account admin)" },
];

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/va/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json?.error) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as T;
}

export default function VaOnboarding() {
  const [step, setStep] = useState<Step>("identity");
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(true);

  // Step 1 state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [vaRole, setVaRole] = useState("operations");

  // Step 2 state
  const [readAgreement, setReadAgreement] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);

  // Step 3 state
  const [timezone, setTimezone] = useState("");
  const [workingHours, setWorkingHours] = useState("");
  const [experience, setExperience] = useState("");
  const [tools, setTools] = useState("");
  const [notes, setNotes] = useState("");

  // Resume a session from this browser.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (!saved) { setResuming(false); return; }
    api<Session>({ action: "status", id: saved })
      .then((s) => {
        setSession((prev) => ({ ...(prev || s), ...s }));
        if (s.status === "started") setStep("agreement");
        else if (s.status === "signed") setStep("form");
        else if (["submitted", "approved", "rejected"].includes(s.status)) setStep("pending");
      })
      .catch(() => localStorage.removeItem(STORAGE_KEY))
      .finally(() => setResuming(false));
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      const s = await api<Session & { agreementPreviewUrl: string | null }>({
        action: "start", email, firstName, lastName, phone, vaRole,
      });
      setSession(s);
      localStorage.setItem(STORAGE_KEY, s.id);
      setLegalName(`${firstName} ${lastName}`.trim());
      setStep(s.agreementSigned ? "form" : "agreement");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start onboarding");
    } finally {
      setBusy(false);
    }
  };

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
        action: "submit", id: session.id, timezone, workingHours, experience, tools, notes,
      });
      setSession((prev) => ({ ...(prev as Session), ...s }));
      setStep("pending");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  };

  const stepIndex = step === "identity" ? 1 : step === "agreement" ? 2 : step === "form" ? 3 : 4;

  if (resuming) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RiLoader4Line className="w-8 h-8 animate-spin text-violet-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 pb-16">
      <SEO title="Join the Novara team — VA onboarding" noindex />
      <div className="max-w-xl mx-auto p-4 pt-8 space-y-5">
        {/* Header */}
        <header className="rounded-3xl bg-gradient-to-br from-violet-700 via-violet-600 to-purple-500 p-6 text-white shadow-xl shadow-violet-200/60">
          <div className="flex items-center gap-2.5">
            <RiTeamLine className="w-6 h-6" />
            <div>
              <p className="font-bold text-lg leading-tight">Novara Cleaning — Team onboarding</p>
              <p className="text-[12px] text-violet-100/90">Virtual assistant intake · agreement · approval</p>
            </div>
          </div>
          {step !== "pending" && (
            <div className="mt-4 flex items-center gap-1.5">
              {["Your info", "Agreement", "Onboarding"].map((label, i) => (
                <div key={label} className="flex-1">
                  <div className={`h-1.5 rounded-full ${i + 1 <= stepIndex ? "bg-white" : "bg-white/25"}`} />
                  <p className="text-[10px] mt-1 text-violet-100/80">{label}</p>
                </div>
              ))}
            </div>
          )}
        </header>

        {/* ── STEP 1: identity ── */}
        {step === "identity" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <RiUser3Line className="w-4 h-4 text-violet-700" /> Step 1 — Who you are
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="First name *" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <Input placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div>
              <Input type="email" placeholder="Email *" value={email} onChange={(e) => setEmail(e.target.value)} />
              <p className="text-[11px] text-slate-400 mt-1">
                Your email is your identity across every system (CRM login, workspace, notifications) — use the one you'll work with.
              </p>
            </div>
            <Input type="tel" placeholder="Phone (WhatsApp ok)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <div>
              <Label className="text-xs text-slate-600">Which role are you onboarding for? *</Label>
              <div className="mt-1.5 space-y-1.5">
                {VA_ROLES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setVaRole(r.id)}
                    className={`w-full text-left rounded-xl border px-3.5 py-2.5 transition-all ${
                      vaRole === r.id
                        ? "border-violet-500 bg-violet-50 ring-1 ring-violet-200"
                        : "border-slate-200 bg-white hover:border-violet-300"
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-900">{r.label}</p>
                    <p className="text-[11px] text-slate-500">{r.hint}</p>
                  </button>
                ))}
              </div>
            </div>
            <Button
              className="w-full h-12 bg-violet-600 hover:bg-violet-700 text-white font-semibold"
              disabled={busy || !firstName.trim() || !email.includes("@")}
              onClick={start}
            >
              {busy ? <RiLoader4Line className="w-5 h-5 animate-spin mr-2" /> : null}
              Continue to the agreement
            </Button>
            <p className="text-[11px] text-slate-400 text-center">
              No access is granted until you've signed the agreement and an admin approves you.
            </p>
          </div>
        )}

        {/* ── STEP 2: read + sign the agreement ── */}
        {step === "agreement" && session && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <RiQuillPenLine className="w-4 h-4 text-violet-700" /> Step 2 — VA Independent Contractor Agreement
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
                <><RiShieldCheckLine className="w-5 h-5 mr-2" /> Sign the agreement</>
              )}
            </Button>
            <p className="text-[11px] text-slate-400 text-center">
              Your signature and timestamp are recorded, and you'll receive your executed copy by email.
            </p>
          </div>
        )}

        {/* ── STEP 3: onboarding form (only after signing) ── */}
        {step === "form" && session && <DiscordJoinCard url={session.discordInviteUrl} />}
        {step === "form" && session && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <RiTimeLine className="w-4 h-4 text-violet-700" /> Step 3 — Onboarding details
              </p>
              <span className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                <RiCheckboxCircleLine className="w-3.5 h-3.5" /> Agreement signed
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-slate-600">Time zone *</Label>
                <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. GMT+8 / Manila" />
              </div>
              <div>
                <Label className="text-xs text-slate-600">Working hours (ET) *</Label>
                <Input value={workingHours} onChange={(e) => setWorkingHours(e.target.value)} placeholder="e.g. 9am–5pm ET Mon–Fri" />
              </div>
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

        {/* ── STEP 4: pending / outcome ── */}
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
