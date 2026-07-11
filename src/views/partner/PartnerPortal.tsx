"use client";

// ─── partner.novaracleaning.com — Host turnover portal ───────────────────
//
// Self-serve portal for Airbnb / short-term-rental hosts: sign up, register
// properties (admin sets the per-turnover price), request + pay for
// turnovers, and track status. Mobile-first. All pricing/payment/assignment
// is enforced server-side by the partner-turnover edge function.

import { useEffect, useState, useCallback } from "react";
import CommercialPortal from "@/views/partner/CommercialPortal";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  RiHome4Line, RiAddLine, RiLoader4Line, RiCalendarLine, RiMapPinLine,
  RiLogoutBoxRLine, RiCheckboxCircleLine, RiTimeLine, RiEditLine, RiSparklingLine,
  RiMailSendLine, RiLockLine, RiUser3Line, RiPhoneLine, RiMailLine,
  RiShieldCheckLine, RiArrowRightLine, RiFlashlightFill, RiKey2Line,
  RiStarFill, RiStarLine, RiCalendarEventLine, RiCloseLine, RiImage2Line,
  RiCalendarScheduleLine, RiDashboardLine, RiTeamLine, RiGroupLine,
  RiExchangeFundsLine, RiUserAddLine, RiBuilding2Line, RiArrowRightUpLine,
} from "@remixicon/react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";

interface Property {
  id: string; nickname: string | null; address: string | null;
  access_instructions: string | null; bedrooms: number | null; bathrooms: number | null;
  sqft: number | null; laundry_included: boolean; restock_included: boolean;
  turnover_price: number | null; special_notes: string | null;
  target_crew_size?: number | null;
}
interface CrewMember { id: string; firstName: string; source?: string }
interface HostCleaners {
  roster: { id: string; firstName: string }[];
  rosterMax: number;
  perPropertyMax: number;
  byProperty: Record<string, CrewMember[]>;
  openRequests: { id: string; property_id: string | null; current_cleaner_id: string | null; kind: string; reason: string | null; status: string }[];
}
interface Turnover {
  id: string; property_id: string; requested_date: string; window_start: string | null;
  window_end: string | null; price: number; status: string; assignment_type: string | null;
  assigned_cleaner_id: string | null; created_at: string;
  cleaner_confirmed_at?: string | null; started_at?: string | null; completed_at?: string | null;
  paid_at?: string | null; assigned_at?: string | null;
  before_photos?: string[] | null; after_photos?: string[] | null;
  host_rating?: number | null; host_review?: string | null;
}

// More than 24h before the service date → host can still self-serve.
const isModifiable = (t: Turnover) => {
  if (["completed", "cancelled"].includes(t.status)) return false;
  const svc = new Date(`${t.requested_date}T12:00:00`).getTime();
  return svc - Date.now() > 24 * 60 * 60 * 1000;
};

// Rough, clearly-labelled ballpark so a pending-pricing property isn't a dead
// end. The admin still sets the binding per-turnover rate; this is guidance.
function estimateRange(p: Pick<Property, "bedrooms" | "bathrooms" | "sqft">): [number, number] {
  const beds = Number(p.bedrooms) || 1;
  const baths = Number(p.bathrooms) || 1;
  const sqft = Number(p.sqft) || 0;
  let base = 90 + beds * 25 + baths * 20;
  if (sqft > 0) base = Math.max(base, 60 + Math.round((sqft / 1000) * 70));
  const low = Math.round(base / 5) * 5;
  return [low, low + 40];
}
function estimateLabel(p: Pick<Property, "bedrooms" | "bathrooms" | "sqft">): string {
  const [lo, hi] = estimateRange(p);
  return `Est. $${lo}–$${hi}/turnover.`;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending_payment: { label: "Awaiting payment", cls: "bg-amber-100 text-amber-700" },
  paid: { label: "Paid · assigning", cls: "bg-blue-100 text-blue-700" },
  assigned: { label: "Assigned", cls: "bg-violet-100 text-violet-700" },
  cleaner_confirmed: { label: "Cleaner confirmed", cls: "bg-emerald-100 text-emerald-700" },
  in_progress: { label: "In progress", cls: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Cancelled", cls: "bg-slate-100 text-slate-500" },
  unassigned_alert: { label: "Finding a cleaner", cls: "bg-amber-100 text-amber-700" },
};

const digits = (s: string) => s.replace(/\D/g, "");

// Recommended dispatch crew size (2–3) from sqft. Prefers the server-stored
// value but falls back to a client estimate so the badge always shows.
const crewSizeFor = (p: Pick<Property, "sqft" | "target_crew_size">): number | null =>
  p.target_crew_size ?? (p.sqft ? (Number(p.sqft) >= 2500 ? 3 : 2) : null);

export default function PartnerPortal() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    // Callback hands recovery sessions back here with ?mode=reset.
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "reset") {
      setRecovery(true);
    }
    return () => sub.subscription.unsubscribe();
  }, []);

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (session && recovery) return <SetPasswordForm onDone={() => setRecovery(false)} />;
  return session ? <PortalRouter /> : <AuthScreen />;
}

// ─── Route the logged-in partner to the right surface by type ───────────────
// STR hosts get the turnover Dashboard; commercial/office partners get the
// CommercialPortal. The lookup runs BEFORE Dashboard mounts because the STR
// dashboard's host.ensure would otherwise create host rows for commercial
// users. Email is the identity key on both sides.
function PortalRouter() {
  const [kind, setKind] = useState<"loading" | "host" | "commercial" | "none">("loading");

  useEffect(() => {
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("partner-commercial-portal", {
          body: { action: "lookup" },
        });
        if (error) throw error;
        const k = (data as { kind?: string })?.kind;
        setKind(k === "commercial" ? "commercial" : k === "none" ? "none" : "host");
      } catch {
        // Lookup hiccup → default to the STR dashboard (pre-existing behavior).
        setKind("host");
      }
    })();
  }, []);

  if (kind === "loading") {
    return <div className="min-h-screen flex items-center justify-center"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (kind === "commercial") return <CommercialPortal />;
  // "none" = brand-new signup → the STR dashboard provisions a host record
  // (existing self-serve host flow). Commercial partners are created by the
  // team from intake, so their email already matches a business account.
  return <Dashboard />;
}

// ─── Brand tokens (purple ramp — used as a scalpel, not a flood) ────────────
const PURPLE_GRADIENT = "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)";
const INPUT_CLS =
  "h-11 pl-10 bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 " +
  "focus-visible:border-[#8F7BFD] focus-visible:ring-2 focus-visible:ring-[#8F7BFD]/25";

const FEATURES = [
  { icon: RiShieldCheckLine, label: "Vetted cleaners", desc: "Background-checked and rated after every clean." },
  { icon: RiFlashlightFill, label: "Auto dispatch", desc: "Matched to your preferred crew the moment you book." },
  { icon: RiKey2Line, label: "Secure access", desc: "Lockbox & gate codes stored safely, shared only on the job." },
];
const STATS = [
  { value: "4.9", label: "Avg rating" },
  { value: "24h", label: "Turnaround" },
  { value: "100%", label: "Vetted crew" },
];

// One signature motion for the surface: a slow aurora drift. Scoped via a
// unique animation name; disabled under prefers-reduced-motion.
function AuroraMotionStyle() {
  return (
    <style>{`
@keyframes nvDriftA{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(30px,-24px,0)}}
@keyframes nvDriftB{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(-26px,20px,0)}}
.nv-drift-a{animation:nvDriftA 14s ease-in-out infinite}
.nv-drift-b{animation:nvDriftB 18s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.nv-drift-a,.nv-drift-b{animation:none}}
`}</style>
  );
}

// ─── Brand panel (desktop only) — aurora + value props + trust stats ───────
function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between" style={{ background: "#0B0920" }}>
      <AuroraMotionStyle />
      {/* Aurora wash + drifting glows + faint grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(55% 45% at 16% 12%, rgba(143,123,253,.55), transparent 60%)," +
              "radial-gradient(45% 40% at 90% 18%, rgba(171,158,253,.32), transparent 60%)," +
              "radial-gradient(70% 65% at 78% 98%, rgba(92,15,254,.5), transparent 62%)",
          }}
        />
        <div className="nv-drift-a absolute -left-24 top-8 h-80 w-80 rounded-full blur-3xl" style={{ background: "rgba(143,123,253,.45)" }} />
        <div className="nv-drift-b absolute -bottom-10 right-0 h-96 w-96 rounded-full blur-3xl" style={{ background: "rgba(92,15,254,.4)" }} />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse at center, #000 40%, transparent 85%)",
          }}
        />
      </div>

      {/* Logo */}
      <div className="relative">
        <img src="/novara-email-logo.png" alt="Novara Cleaning" className="h-8 w-auto" style={{ filter: "brightness(0) invert(1)" }} />
      </div>

      {/* Headline + value props */}
      <div className="relative max-w-md">
        <h2 className="font-jakarta text-3xl font-bold leading-[1.15] tracking-tight xl:text-[2.6rem]">
          Turnover cleanings,<br />handled for you.
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-white/70">
          List your rentals, lock in a per-turnover rate, and we dispatch a vetted crew — guest-ready by every check-in.
        </p>
        <ul className="mt-9 space-y-5">
          {FEATURES.map((f) => (
            <li key={f.label} className="flex items-start gap-3.5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
                <f.icon className="h-[18px] w-[18px] text-white" />
              </span>
              <div>
                <p className="text-sm font-semibold leading-tight">{f.label}</p>
                <p className="mt-0.5 text-xs leading-snug text-white/55">{f.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Trust stats — tabular mono numerals */}
      <div className="relative flex items-center gap-9">
        {STATS.map((s) => (
          <div key={s.label}>
            <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight">{s.value}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-white/45">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Shared auth shell — premium split layout (brand panel + form) ─────────
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-[#FAFAFC] lg:grid lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />
      <div className="relative flex min-h-screen items-center justify-center px-5 py-12 sm:px-10">
        {/* Faint top accent on the form side for warmth */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-40 lg:hidden"
          style={{ background: "radial-gradient(80% 100% at 50% 0%, rgba(143,123,253,.10), transparent 70%)" }}
        />
        <div className="relative w-full max-w-[400px] space-y-8">
          {/* Compact brand for mobile (brand panel is desktop-only) */}
          <div className="flex flex-col items-center gap-2 lg:hidden">
            <img src="/novara-email-logo.png" alt="Novara Cleaning" className="h-7 w-auto" />
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">Host Portal</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

// Official multicolor Google "G" so the OAuth button reads as authentic.
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

// ─── Set a new password (recovery) ─────────────────────────────────────────
function SetPasswordForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (password.length < 6) { toast.error("Use a 6+ character password."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Password updated.");
    if (typeof window !== "undefined") window.history.replaceState({}, "", "/partner/dashboard");
    onDone();
  };
  return (
    <AuthShell>
      <SEO title="Set a new password" noindex />
      <div className="rounded-2xl border border-slate-200/70 bg-white p-7 shadow-[0_1px_3px_rgba(16,24,40,0.06),0_18px_50px_-20px_rgba(92,15,254,0.25)]">
        <div className="space-y-1.5">
          <h1 className="font-jakarta text-2xl font-bold tracking-tight text-slate-900">Set a new password</h1>
          <p className="text-sm text-slate-500">Choose a strong password for your host account.</p>
        </div>
        <div className="mt-6 space-y-1.5">
          <Label className="text-slate-700">New password</Label>
          <div className="relative">
            <RiLockLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={INPUT_CLS} />
          </div>
        </div>
        <Button onClick={submit} disabled={busy} className="mt-6 h-11 w-full font-semibold text-white shadow-lg shadow-[#5C0FFE]/25 transition hover:opacity-95" style={{ background: PURPLE_GRADIENT }}>
          {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : "Update password"}
        </Button>
      </div>
    </AuthShell>
  );
}

// ─── Auth ────────────────────────────────────────────────────────────────
type AuthMode = "login" | "signup" | "forgot" | "check-email";

function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>("signup");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const cleanEmail = () => email.trim().toLowerCase();

  const doGoogle = async () => {
    setGoogleBusy(true);
    const origin = typeof window !== "undefined" ? window.location.origin : "https://partner.novaracleaning.com";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/partner/auth/callback`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    // On success the browser redirects to Google, so we only reach here on error.
    if (error) {
      toast.error(error.message || "Could not start Google sign-in");
      setGoogleBusy(false);
    }
  };

  const doSignup = async () => {
    if (!name.trim() || digits(phone).length < 10) { toast.error("Add your name and phone."); return; }
    if (!email.trim() || password.length < 6) { toast.error("Enter your email and a 6+ character password."); return; }
    setBusy(true);
    try {
      // Route through send-auth-email → branded confirmation link (creates the
      // user via admin.generateLink). Never reveals if the email exists.
      const { error } = await supabase.functions.invoke("send-partner-auth-email", {
        body: { kind: "signup", email: cleanEmail(), password, firstName: name.trim(), metadata: { phone: digits(phone) } },
      });
      if (error) throw error;
      setMode("check-email");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create account");
    } finally { setBusy(false); }
  };

  const doLogin = async () => {
    if (!email.trim() || !password) { toast.error("Enter your email and password."); return; }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail(), password });
    setBusy(false);
    if (error) {
      if (/not confirmed/i.test(error.message)) {
        toast.error("Please confirm your email first — check your inbox.");
        setMode("check-email");
      } else {
        toast.error("Invalid email or password.");
      }
    }
  };

  const doForgot = async () => {
    if (!email.trim()) { toast.error("Enter your email."); return; }
    setBusy(true);
    await supabase.functions.invoke("send-partner-auth-email", { body: { kind: "password_reset", email: cleanEmail() } }).catch(() => {});
    setBusy(false);
    toast.success("If that email has an account, a reset link is on its way.");
    setMode("login");
  };

  const resendConfirm = async () => {
    await supabase.functions.invoke("send-partner-auth-email", { body: { kind: "signup", email: cleanEmail(), password: password || undefined, firstName: name.trim() || undefined } }).catch(() => {});
    toast.success("Confirmation email resent.");
  };

  const primaryLabel = mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in";
  const headline = mode === "login" ? "Welcome back" : mode === "forgot" ? "Reset your password" : "Create your host account";
  const subline =
    mode === "login" ? "Sign in to manage your turnovers."
    : mode === "forgot" ? "We'll email you a secure reset link."
    : "Turnover cleanings for your rentals — booked in seconds.";

  return (
    <AuthShell>
      <SEO title="Host Portal" description="Request Airbnb & short-term-rental turnover cleanings." noindex />

      <div className="rounded-2xl border border-slate-200/70 bg-white p-7 shadow-[0_1px_3px_rgba(16,24,40,0.06),0_18px_50px_-20px_rgba(92,15,254,0.25)]">
        <div className="space-y-1.5">
          <h1 className="font-jakarta text-[26px] font-bold leading-tight tracking-tight text-slate-900">{headline}</h1>
          <p className="text-sm text-slate-500">{subline}</p>
        </div>

        {mode === "check-email" ? (
          <div className="mt-6 space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5C0FFE]/10">
              <RiMailSendLine className="h-7 w-7 text-[#5C0FFE]" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">Check your email</p>
              <p className="mt-1 text-sm text-slate-500">We sent a confirmation link to <span className="font-medium text-slate-700">{cleanEmail() || "your inbox"}</span>. Click it to finish setting up your account.</p>
            </div>
            <Button variant="outline" className="h-11 w-full" onClick={resendConfirm}>Resend confirmation</Button>
            <button className="text-sm font-medium text-[#5C0FFE] hover:underline" onClick={() => setMode("login")}>Back to sign in</button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {/* Google OAuth — works for both sign in and sign up */}
            {mode !== "forgot" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={doGoogle}
                  disabled={googleBusy || busy}
                  className="h-11 w-full gap-2.5 border-slate-200 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {googleBusy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <GoogleIcon className="h-5 w-5" />}
                  Continue with Google
                </Button>
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">or {mode === "signup" ? "sign up" : "sign in"} with email</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
              </>
            )}

            {mode === "signup" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-slate-700">Name</Label>
                  <div className="relative">
                    <RiUser3Line className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={INPUT_CLS} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-700">Phone</Label>
                  <div className="relative">
                    <RiPhoneLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(301) 555-0100" className={INPUT_CLS} />
                  </div>
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label className="text-slate-700">Email</Label>
              <div className="relative">
                <RiMailLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" className={INPUT_CLS} />
              </div>
            </div>
            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <Label className="text-slate-700">Password</Label>
                <div className="relative">
                  <RiLockLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={INPUT_CLS} />
                </div>
              </div>
            )}
            {mode === "login" && (
              <div className="-mt-1 text-right">
                <button className="text-xs font-medium text-[#5C0FFE] hover:underline" onClick={() => setMode("forgot")}>Forgot password?</button>
              </div>
            )}
            <Button onClick={mode === "signup" ? doSignup : mode === "forgot" ? doForgot : doLogin} disabled={busy || googleBusy} className="h-11 w-full font-semibold text-white shadow-lg shadow-[#5C0FFE]/25 transition hover:opacity-95" style={{ background: PURPLE_GRADIENT }}>
              {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : (<>{primaryLabel}<RiArrowRightLine className="ml-1.5 h-4 w-4" /></>)}
            </Button>
            <p className="text-center text-sm text-slate-500">
              {mode === "forgot" ? (
                <button className="font-semibold text-[#5C0FFE] hover:underline" onClick={() => setMode("login")}>Back to sign in</button>
              ) : mode === "signup" ? (
                <>Already have an account? <button className="font-semibold text-[#5C0FFE] hover:underline" onClick={() => setMode("login")}>Sign in</button></>
              ) : (
                <>New here? <button className="font-semibold text-[#5C0FFE] hover:underline" onClick={() => setMode("signup")}>Create one</button></>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Mobile trust row (brand panel carries this on desktop) */}
      <div className="flex items-center justify-center gap-5 text-xs text-slate-400 lg:hidden">
        <span className="flex items-center gap-1.5"><RiShieldCheckLine className="h-4 w-4" /> Vetted</span>
        <span className="flex items-center gap-1.5"><RiCheckboxCircleLine className="h-4 w-4" /> Secure</span>
        <span className="flex items-center gap-1.5"><RiTimeLine className="h-4 w-4" /> Guest-ready</span>
      </div>
    </AuthShell>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────────────────
type HostTab = "overview" | "properties" | "turnovers" | "cleaners" | "photos";

function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [turnovers, setTurnovers] = useState<Turnover[]>([]);
  const [cleaners, setCleaners] = useState<HostCleaners | null>(null);
  const [tab, setTab] = useState<HostTab>("overview");
  const [showPropForm, setShowPropForm] = useState(false);
  const [editingProp, setEditingProp] = useState<Property | null>(null);
  const [requestFor, setRequestFor] = useState<Property | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<Turnover | null>(null);
  const [rateFor, setRateFor] = useState<Turnover | null>(null);
  const [photoFor, setPhotoFor] = useState<Turnover | null>(null);
  const [requestCleanerFor, setRequestCleanerFor] = useState<{ property: Property; current?: CrewMember; kind: "replace" | "additional" } | null>(null);
  const router = useRouter();

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    await supabase.functions.invoke("partner-turnover", { body: { action: "host.ensure" } }).catch(() => {});
    const [{ data: props }, { data: trs }, cleanersRes] = await Promise.all([
      (supabase.from as any)("properties").select("*").order("created_at", { ascending: false }),
      (supabase.from as any)("turnover_requests").select("*").order("created_at", { ascending: false }),
      supabase.functions.invoke("host-cleaners", { body: { action: "host.cleaners" } }).catch(() => ({ data: null })),
    ]);
    setProperties((props as Property[]) || []);
    setTurnovers((trs as Turnover[]) || []);
    const cd = (cleanersRes as { data: unknown })?.data as HostCleaners | null;
    if (cd && !(cd as unknown as { error?: string }).error) setCleaners(cd);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live updates — reflect assignment / confirmation / completion without a
  // manual refresh. Silent reload avoids the full-page spinner.
  useEffect(() => {
    const channel = supabase
      .channel("partner-portal-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "turnover_requests" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "properties" }, () => load(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const propName = (id: string) => properties.find((p) => p.id === id)?.nickname || properties.find((p) => p.id === id)?.address || "Property";

  const todayYmd = new Date().toISOString().slice(0, 10);
  const todays = turnovers.filter((t) => t.requested_date === todayYmd && t.status !== "cancelled");
  const upcoming = turnovers.filter((t) => t.requested_date >= todayYmd && !["cancelled", "completed"].includes(t.status));
  const activeProps = properties.filter((p) => p.turnover_price != null && Number(p.turnover_price) > 0);
  const ratings = turnovers.filter((t) => t.host_rating).map((t) => t.host_rating as number);
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const photoTurnovers = turnovers.filter((t) => (t.before_photos?.length || 0) + (t.after_photos?.length || 0) > 0);

  const TABS: { id: HostTab; label: string; icon: typeof RiDashboardLine }[] = [
    { id: "overview", label: "Overview", icon: RiDashboardLine },
    { id: "properties", label: "Properties", icon: RiBuilding2Line },
    { id: "turnovers", label: "Turnovers", icon: RiCalendarEventLine },
    { id: "cleaners", label: "Cleaners", icon: RiTeamLine },
    { id: "photos", label: "Photos", icon: RiImage2Line },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO title="Host Dashboard" noindex />
      {/* Premium gradient header */}
      <header className="sticky top-0 z-20 text-white" style={{ background: "linear-gradient(120deg,#5C0FFE 0%,#7A3BFF 55%,#9F7BFF 100%)" }}>
        <div className="max-w-4xl mx-auto px-4 pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/15"><RiSparklingLine className="w-4 h-4" /></span>
              Host Portal
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" className="bg-white/15 text-white border-0 hover:bg-white/25" onClick={() => router.push("/partner/calendar")}>
                <RiCalendarEventLine className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Calendar</span>
              </Button>
              <Button variant="secondary" size="sm" className="bg-white/15 text-white border-0 hover:bg-white/25" onClick={() => router.push("/partner/schedule")}>
                <RiCalendarScheduleLine className="w-4 h-4 sm:mr-1.5" /><span className="hidden sm:inline">Weekly</span>
              </Button>
              <Button variant="ghost" size="sm" className="text-white hover:bg-white/15" onClick={() => supabase.auth.signOut()}><RiLogoutBoxRLine className="w-4 h-4" /></Button>
            </div>
          </div>
          {/* Tab nav */}
          <div className="mt-4 flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition", tab === t.id ? "bg-white text-[#5C0FFE] shadow-sm" : "text-white/85 hover:bg-white/10")}>
                <t.icon className="w-4 h-4" /> {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-16"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>
        ) : tab === "overview" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiTile icon={RiBuilding2Line} label="Active properties" value={String(activeProps.length)} sub={properties.length > activeProps.length ? `${properties.length - activeProps.length} pending pricing` : "all priced"} />
              <KpiTile icon={RiCalendarEventLine} label="Upcoming" value={String(upcoming.length)} sub="turnovers scheduled" />
              <KpiTile icon={RiTimeLine} label="Today" value={String(todays.length)} sub="turnovers today" />
              <KpiTile icon={RiStarFill} label="Avg rating" value={avgRating ? avgRating.toFixed(1) : "—"} sub={`${ratings.length} rated`} />
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <QuickAction icon={RiAddLine} label="Add property" onClick={() => { setEditingProp(null); setShowPropForm(true); }} />
              <QuickAction icon={RiCalendarEventLine} label="Open calendar" onClick={() => router.push("/partner/calendar")} />
              <QuickAction icon={RiCalendarScheduleLine} label="Weekly schedule" onClick={() => router.push("/partner/schedule")} />
            </div>

            <section className="space-y-3">
              <h2 className="text-base font-bold flex items-center gap-2"><RiTimeLine className="w-4 h-4 text-[#5C0FFE]" /> Today's turnovers</h2>
              {todays.length === 0 ? (
                <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Nothing scheduled for today. Use the calendar to book turnovers.</CardContent></Card>
              ) : (
                <div className="grid gap-3">
                  {todays.map((t) => (
                    <TurnoverCard key={t.id} turnover={t} propertyName={propName(t.property_id)} cleanerName={cleanerNameFor(cleaners, t.assigned_cleaner_id)} onReschedule={() => setRescheduleFor(t)} onRate={() => setRateFor(t)} onViewPhotos={() => setPhotoFor(t)} onChanged={load} />
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : tab === "properties" ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Your properties</h2>
              <Button size="sm" style={{ background: "#5C0FFE" }} onClick={() => { setEditingProp(null); setShowPropForm(true); }}>
                <RiAddLine className="w-4 h-4 mr-1" /> Add property
              </Button>
            </div>
            {properties.length === 0 && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No properties yet. Add your first rental to request turnovers.</CardContent></Card>}
            <div className="grid gap-3 sm:grid-cols-2">
              {properties.map((p) => {
                const priced = p.turnover_price != null && Number(p.turnover_price) > 0;
                const crew = cleaners?.byProperty?.[p.id] || [];
                return (
                  <Card key={p.id} className="overflow-hidden">
                    <div className="h-1.5" style={{ background: priced ? "linear-gradient(90deg,#5C0FFE,#9F7BFF)" : "#FCD34D" }} />
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold flex items-center gap-2"><RiHome4Line className="w-4 h-4 text-[#5C0FFE]" /> {p.nickname || "Property"}</p>
                          <p className="text-xs text-muted-foreground truncate">{p.address}</p>
                          <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
                            {p.bedrooms != null && <Badge variant="secondary">{p.bedrooms} BR</Badge>}
                            {p.bathrooms != null && <Badge variant="secondary">{p.bathrooms} BA</Badge>}
                            {p.sqft ? <Badge variant="secondary">{p.sqft} sqft</Badge> : null}
                            {crewSizeFor(p) ? <Badge variant="secondary" className="bg-violet-50 text-[#5C0FFE]">{crewSizeFor(p)}-person crew</Badge> : null}
                            {p.laundry_included && <Badge variant="secondary">Laundry</Badge>}
                            {p.restock_included && <Badge variant="secondary">Restock</Badge>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {priced ? (
                            <p className="font-bold text-[#5C0FFE]">${Number(p.turnover_price).toFixed(0)}<span className="text-[11px] text-muted-foreground">/turnover</span></p>
                          ) : (
                            <div><Badge className="bg-amber-100 text-amber-700">Pending pricing</Badge><p className="text-[11px] text-muted-foreground mt-1">{estimateLabel(p)}</p></div>
                          )}
                        </div>
                      </div>
                      {crew.length > 0 && (
                        <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5"><RiTeamLine className="w-3.5 h-3.5" /> Crew: {crew.map((c) => c.firstName).join(", ")}</p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-3">
                        <Button size="sm" variant="outline" onClick={() => { setEditingProp(p); setShowPropForm(true); }}><RiEditLine className="w-3.5 h-3.5 mr-1" /> Edit</Button>
                        <Button size="sm" variant="outline" onClick={() => setTab("cleaners")}><RiTeamLine className="w-3.5 h-3.5 mr-1" /> Cleaners</Button>
                        <Button size="sm" disabled={!priced} style={priced ? { background: "#5C0FFE" } : undefined} onClick={() => setRequestFor(p)}><RiCalendarLine className="w-3.5 h-3.5 mr-1" /> Request</Button>
                      </div>
                      {!priced && <p className="text-[11px] text-amber-600 mt-2">Our team is confirming your per-turnover rate — {estimateLabel(p).toLowerCase()} You'll be able to book once it's set.</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ) : tab === "turnovers" ? (
          <section className="space-y-3">
            <h2 className="text-lg font-bold">Turnovers</h2>
            {turnovers.length === 0 && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No turnover requests yet.</CardContent></Card>}
            <div className="grid gap-3">
              {turnovers.map((t) => (
                <TurnoverCard key={t.id} turnover={t} propertyName={propName(t.property_id)} cleanerName={cleanerNameFor(cleaners, t.assigned_cleaner_id)} onReschedule={() => setRescheduleFor(t)} onRate={() => setRateFor(t)} onViewPhotos={() => setPhotoFor(t)} onChanged={load} />
              ))}
            </div>
          </section>
        ) : tab === "cleaners" ? (
          <CleanersTab
            properties={properties}
            cleaners={cleaners}
            onRequest={(property, current, kind) => setRequestCleanerFor({ property, current, kind })}
          />
        ) : (
          <TodayPhotosTab turnovers={photoTurnovers} propName={propName} todayYmd={todayYmd} />
        )}
      </main>

      {showPropForm && (
        <PropertyForm property={editingProp} onClose={() => setShowPropForm(false)} onSaved={() => { setShowPropForm(false); load(); }} />
      )}
      {requestFor && (
        <RequestForm property={requestFor} onClose={() => setRequestFor(null)} onPaid={() => { setRequestFor(null); load(); }} />
      )}
      {rescheduleFor && (
        <RescheduleForm turnover={rescheduleFor} onClose={() => setRescheduleFor(null)} onDone={() => { setRescheduleFor(null); load(); }} />
      )}
      {rateFor && (
        <RateForm turnover={rateFor} onClose={() => setRateFor(null)} onDone={() => { setRateFor(null); load(); }} />
      )}
      {photoFor && (
        <PhotosViewer turnover={photoFor} onClose={() => setPhotoFor(null)} />
      )}
      {requestCleanerFor && (
        <RequestCleanerModal
          ctx={requestCleanerFor}
          onClose={() => setRequestCleanerFor(null)}
          onDone={() => { setRequestCleanerFor(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Turnover card — status timeline, photos, host actions ─────────────────
const TIMELINE_STEPS = [
  { key: "paid", label: "Booked" },
  { key: "assigned", label: "Assigned" },
  { key: "cleaner_confirmed", label: "Confirmed" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Complete" },
];
// How far along each status is on the 5-step timeline.
const STATUS_STEP: Record<string, number> = {
  pending_payment: 0, paid: 0, unassigned_alert: 0,
  assigned: 1, cleaner_confirmed: 2, in_progress: 3, completed: 4,
};

function cleanerNameFor(cleaners: HostCleaners | null, cleanerId: string | null): string | undefined {
  if (!cleaners || !cleanerId) return undefined;
  return cleaners.roster.find((c) => c.id === cleanerId)?.firstName;
}

function TurnoverCard({
  turnover: t, propertyName, cleanerName, onReschedule, onRate, onViewPhotos, onChanged,
}: {
  turnover: Turnover; propertyName: string; cleanerName?: string;
  onReschedule: () => void; onRate: () => void; onViewPhotos: () => void; onChanged: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const st = STATUS_LABEL[t.status] || { label: t.status, cls: "bg-slate-100 text-slate-600" };
  const modifiable = isModifiable(t);
  const cancelled = t.status === "cancelled";
  const completed = t.status === "completed";
  const photoCount = (t.before_photos?.length || 0) + (t.after_photos?.length || 0);
  const showTimeline = !cancelled && t.status !== "pending_payment";
  const currentStep = STATUS_STEP[t.status] ?? 0;

  const doCancel = async () => {
    setCancelling(true);
    const { data, error } = await supabase.functions.invoke("partner-turnover", {
      body: { action: "turnover.cancel", turnoverId: t.id },
    });
    setCancelling(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || "Could not cancel"); return; }
    toast.success("Turnover cancelled");
    setConfirmCancel(false);
    onChanged();
  };

  return (
    <Card className={cn(cancelled && "opacity-70")}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate flex items-center gap-1.5"><RiMapPinLine className="w-4 h-4 text-primary" />{propertyName}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <RiTimeLine className="w-3 h-3" />{format(new Date(`${t.requested_date}T12:00:00`), "EEE, MMM d")}
              {t.window_start ? ` · ${t.window_start.slice(0, 5)}–${(t.window_end || "").slice(0, 5)}` : ""}
            </p>
            {cleanerName && (
              <p className="text-xs text-[#5C0FFE] flex items-center gap-1.5 mt-0.5 font-medium">
                <RiTeamLine className="w-3 h-3" /> Cleaner: {cleanerName}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <Badge className={cn("text-[11px]", st.cls)}>{st.label}</Badge>
            <p className="text-sm font-semibold mt-1">${Number(t.price).toFixed(0)}</p>
          </div>
        </div>

        {showTimeline && (
          <div className="flex items-center gap-1 pt-1">
            {TIMELINE_STEPS.map((step, i) => {
              const done = i <= currentStep;
              return (
                <div key={step.key} className="flex-1 flex flex-col items-center gap-1">
                  <div className="flex items-center w-full">
                    <div className={cn("h-1 flex-1 rounded-full", i === 0 ? "bg-transparent" : done ? "bg-[#5C0FFE]" : "bg-slate-200")} />
                    <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", done ? "bg-[#5C0FFE]" : "bg-slate-200")} />
                    <div className={cn("h-1 flex-1 rounded-full", i === TIMELINE_STEPS.length - 1 ? "bg-transparent" : i < currentStep ? "bg-[#5C0FFE]" : "bg-slate-200")} />
                  </div>
                  <span className={cn("text-[9px] leading-none text-center", done ? "text-[#5C0FFE] font-medium" : "text-slate-400")}>{step.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {t.status === "unassigned_alert" && (
          <p className="text-[11px] text-amber-600">We're matching you with a cleaner and will confirm shortly.</p>
        )}

        {/* Host rating (completed) */}
        {completed && t.host_rating ? (
          <div className="flex items-center gap-1 text-amber-500">
            {[1, 2, 3, 4, 5].map((n) => (
              n <= (t.host_rating || 0) ? <RiStarFill key={n} className="w-4 h-4" /> : <RiStarLine key={n} className="w-4 h-4 text-slate-300" />
            ))}
            <span className="text-xs text-muted-foreground ml-1">Your rating</span>
          </div>
        ) : null}

        {/* Actions */}
        {(modifiable || (completed && !t.host_rating) || photoCount > 0) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {photoCount > 0 && (
              <Button size="sm" variant="outline" onClick={onViewPhotos}>
                <RiImage2Line className="w-3.5 h-3.5 mr-1" /> Photos ({photoCount})
              </Button>
            )}
            {completed && !t.host_rating && (
              <Button size="sm" onClick={onRate}>
                <RiStarLine className="w-3.5 h-3.5 mr-1" /> Rate clean
              </Button>
            )}
            {modifiable && !confirmCancel && (
              <>
                <Button size="sm" variant="outline" onClick={onReschedule}>
                  <RiCalendarEventLine className="w-3.5 h-3.5 mr-1" /> Reschedule
                </Button>
                <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => setConfirmCancel(true)}>
                  <RiCloseLine className="w-3.5 h-3.5 mr-1" /> Cancel
                </Button>
              </>
            )}
            {modifiable && confirmCancel && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Cancel this turnover?</span>
                <Button size="sm" variant="outline" onClick={() => setConfirmCancel(false)}>Keep</Button>
                <Button size="sm" disabled={cancelling} className="bg-red-600 hover:bg-red-700" onClick={doCancel}>
                  {cancelling ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : "Yes, cancel"}
                </Button>
              </div>
            )}
          </div>
        )}
        {!modifiable && !completed && !cancelled && t.status !== "pending_payment" && (
          <p className="text-[11px] text-muted-foreground">Within 24 hours of service — contact support to make changes.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Reschedule (modal) ────────────────────────────────────────────────────
function RescheduleForm({ turnover, onClose, onDone }: { turnover: Turnover; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(turnover.requested_date);
  const [start, setStart] = useState((turnover.window_start || "11:00").slice(0, 5));
  const [end, setEnd] = useState((turnover.window_end || "15:00").slice(0, 5));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!date) { toast.error("Pick a date."); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("partner-turnover", {
      body: { action: "turnover.reschedule", turnoverId: turnover.id, requested_date: date, window_start: start, window_end: end },
    });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || "Could not reschedule"); return; }
    toast.success("Turnover rescheduled — re-assigning your crew.");
    onDone();
  };
  return (
    <Modal onClose={onClose} title="Reschedule turnover">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Pick a new date and window. We'll re-assign a cleaner automatically — no extra charge.</p>
        <div><Label>New date *</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Checkout time</Label><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><Label>Next check-in by</Label><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <Button onClick={submit} disabled={busy} className="w-full h-11">
          {busy ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Confirm new date"}
        </Button>
      </div>
    </Modal>
  );
}

// ─── Rate clean (modal) ────────────────────────────────────────────────────
function RateForm({ turnover, onClose, onDone }: { turnover: Turnover; onClose: () => void; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [review, setReview] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (rating < 1) { toast.error("Tap a star to rate."); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("partner-turnover", {
      body: { action: "turnover.rate", turnoverId: turnover.id, rating, review },
    });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || "Could not save rating"); return; }
    toast.success("Thanks for the feedback!");
    onDone();
  };
  return (
    <Modal onClose={onClose} title="Rate your clean">
      <div className="space-y-4">
        <div className="flex justify-center gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => setRating(n)}>
              {n <= (hover || rating)
                ? <RiStarFill className="w-9 h-9 text-amber-400" />
                : <RiStarLine className="w-9 h-9 text-slate-300" />}
            </button>
          ))}
        </div>
        <div><Label>Comments (optional)</Label><Textarea rows={3} value={review} onChange={(e) => setReview(e.target.value)} placeholder="How did the crew do?" /></div>
        <Button onClick={submit} disabled={busy} className="w-full h-11">
          {busy ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Submit rating"}
        </Button>
      </div>
    </Modal>
  );
}

// ─── Before / after photos (modal) ─────────────────────────────────────────
function PhotosViewer({ turnover, onClose }: { turnover: Turnover; onClose: () => void }) {
  const before = turnover.before_photos || [];
  const after = turnover.after_photos || [];
  const Section = ({ title, urls }: { title: string; urls: string[] }) => (
    urls.length ? (
      <div className="space-y-2">
        <p className="text-sm font-semibold">{title}</p>
        <div className="grid grid-cols-2 gap-2">
          {urls.map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border bg-slate-100">
              <img src={u} alt={`${title} ${i + 1}`} className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      </div>
    ) : null
  );
  return (
    <Modal onClose={onClose} title="Turnover photos">
      <div className="space-y-4">
        {before.length === 0 && after.length === 0 && <p className="text-sm text-muted-foreground">No photos yet.</p>}
        <Section title="Before" urls={before} />
        <Section title="After" urls={after} />
      </div>
    </Modal>
  );
}

// ─── Property form (modal) ─────────────────────────────────────────────────
function PropertyForm({ property, onClose, onSaved }: { property: Property | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    nickname: property?.nickname || "", address: property?.address || "",
    access_instructions: property?.access_instructions || "",
    bedrooms: property?.bedrooms?.toString() || "", bathrooms: property?.bathrooms?.toString() || "",
    sqft: property?.sqft?.toString() || "",
    laundry_included: property?.laundry_included || false, restock_included: property?.restock_included || false,
    special_notes: property?.special_notes || "",
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.nickname.trim() || !f.address.trim()) { toast.error("Add a nickname and address."); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("partner-turnover", {
      body: { action: "property.save", propertyId: property?.id, ...f },
    });
    setBusy(false);
    if (error || (data as any)?.error) { toast.error((data as any)?.error || "Could not save"); return; }
    toast.success(property ? "Property updated" : "Property added — pending pricing");
    onSaved();
  };
  return (
    <Modal onClose={onClose} title={property ? "Edit property" : "Add property"}>
      <div className="space-y-3">
        <div><Label>Nickname *</Label><Input value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} placeholder="Lakehouse 2BR" /></div>
        <div><Label>Address *</Label><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="123 Lake Dr, Columbia, MD" /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><Label>Beds</Label><Input value={f.bedrooms} onChange={(e) => setF({ ...f, bedrooms: e.target.value })} inputMode="numeric" /></div>
          <div><Label>Baths</Label><Input value={f.bathrooms} onChange={(e) => setF({ ...f, bathrooms: e.target.value })} inputMode="decimal" /></div>
          <div><Label>Sq ft</Label><Input value={f.sqft} onChange={(e) => setF({ ...f, sqft: e.target.value })} inputMode="numeric" /></div>
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.laundry_included} onChange={(e) => setF({ ...f, laundry_included: e.target.checked })} /> Linens / laundry on-site</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.restock_included} onChange={(e) => setF({ ...f, restock_included: e.target.checked })} /> Restock consumables</label>
        </div>
        <div><Label>Access instructions</Label><Textarea rows={2} value={f.access_instructions} onChange={(e) => setF({ ...f, access_instructions: e.target.value })} placeholder="Lockbox 1234, gate code, parking, where supplies are…" /></div>
        <div><Label>Special notes</Label><Textarea rows={2} value={f.special_notes} onChange={(e) => setF({ ...f, special_notes: e.target.value })} placeholder="Staging prefs, quirks…" /></div>
        <Button onClick={save} disabled={busy} className="w-full">
          {busy ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Save property"}
        </Button>
      </div>
    </Modal>
  );
}

// ─── Request turnover (modal → one-tap saved card or Stripe checkout) ──────
type PayOption = "full" | "split" | "pay_after";

function RequestForm({ property, onClose, onPaid }: { property: Property; onClose: () => void; onPaid: () => void }) {
  const [date, setDate] = useState("");
  const [start, setStart] = useState("11:00");
  const [end, setEnd] = useState("15:00");
  const [busy, setBusy] = useState(false);
  const [savedCard, setSavedCard] = useState<{ brand: string; last4: string } | null>(null);
  const [payOption, setPayOption] = useState<PayOption>("full");

  const price = Number(property.turnover_price);
  const fmt = (n: number) => `$${n.toFixed(0)}`;
  const priceLabel = fmt(price);
  const halfLabel = fmt(price / 2);

  useEffect(() => {
    supabase.functions.invoke("partner-turnover", { body: { action: "turnover.paymentInfo" } })
      .then(({ data }) => {
        if ((data as any)?.hasSavedCard) setSavedCard({ brand: (data as any).brand, last4: (data as any).last4 });
      })
      .catch(() => {});
  }, []);

  // Save a card on file (no charge) — required before a "pay after" turnover.
  const startSetup = async () => {
    const { data } = await supabase.functions.invoke("partner-turnover", { body: { action: "host.setupPaymentMethod" } });
    if ((data as any)?.url) { window.location.href = (data as any).url; return true; }
    toast.error("Could not open the card-setup page.");
    setBusy(false);
    return false;
  };

  // Hosted Stripe Checkout (new card) — used for full/split when no saved card.
  const checkout = async () => {
    const { data, error } = await supabase.functions.invoke("partner-turnover", {
      body: { action: "turnover.request", propertyId: property.id, requested_date: date, window_start: start, window_end: end, paymentOption: payOption },
    });
    if ((data as any)?.needsSetup) { await startSetup(); return; }
    if (error || (data as any)?.error || !(data as any)?.url) {
      setBusy(false);
      toast.error((data as any)?.error || "Could not start checkout");
      return;
    }
    window.location.href = (data as any).url;
  };

  const submit = async () => {
    if (!date) { toast.error("Pick a date."); return; }
    setBusy(true);

    // pay_after never uses Checkout (nothing to charge now); split/full one-tap
    // when a card is on file, else hosted Checkout.
    if (payOption === "pay_after" || savedCard) {
      const { data, error } = await supabase.functions.invoke("partner-turnover", {
        body: { action: "turnover.requestSaved", propertyId: property.id, requested_date: date, window_start: start, window_end: end, paymentOption: payOption },
      });
      if (error || (data as any)?.error) {
        setBusy(false);
        toast.error((data as any)?.error || "Could not complete request");
        return;
      }
      if ((data as any)?.paid || (data as any)?.scheduled) {
        toast.success(payOption === "pay_after" ? "Turnover scheduled — you'll be charged after it's completed." : "Turnover booked — assigning your crew.");
        onPaid();
        return;
      }
      if ((data as any)?.needsSetup) { await startSetup(); return; }
      // needsCheckout → hosted Checkout (full/split only).
      await checkout();
      return;
    }
    await checkout();
  };

  const cardName = savedCard ? `${savedCard.brand[0].toUpperCase()}${savedCard.brand.slice(1)} ••${savedCard.last4}` : "";
  const cta = (() => {
    if (busy) return null;
    if (payOption === "pay_after") return savedCard ? `Schedule — pay ${priceLabel} after` : "Save a card to schedule";
    const amt = payOption === "split" ? halfLabel : priceLabel;
    const suffix = payOption === "split" ? " now" : "";
    return savedCard ? `Pay ${amt}${suffix} with ${cardName}` : `Pay ${amt}${suffix} & request`;
  })();

  const OPTIONS: { key: PayOption; title: string; sub: string }[] = [
    { key: "full", title: "Pay in full", sub: `${priceLabel} now` },
    { key: "split", title: "Split 50/50", sub: `${halfLabel} now · ${halfLabel} on completion` },
    { key: "pay_after", title: "Pay after", sub: `$0 now · ${priceLabel} when complete` },
  ];

  return (
    <Modal onClose={onClose} title={`Request turnover — ${property.nickname || "Property"}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 flex items-center justify-between">
          <span className="text-sm">Per-turnover price</span>
          <span className="font-bold text-primary">{priceLabel}</span>
        </div>
        <div><Label>Date *</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Checkout time</Label><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><Label>Next check-in by</Label><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>

        <div className="space-y-1.5">
          <Label>Payment</Label>
          <div className="grid gap-1.5">
            {OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setPayOption(o.key)}
                className={`flex items-center justify-between rounded-lg border p-2.5 text-left transition-colors ${payOption === o.key ? "border-primary bg-primary/5" : "border-slate-200 hover:bg-slate-50"}`}
              >
                <span>
                  <span className="block text-sm font-medium">{o.title}</span>
                  <span className="block text-[11px] text-muted-foreground">{o.sub}</span>
                </span>
                <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${payOption === o.key ? "border-primary bg-primary" : "border-slate-300"}`} />
              </button>
            ))}
          </div>
          {payOption === "pay_after" && !savedCard && (
            <p className="text-[11px] text-amber-600">We'll save a card on file (no charge today) and charge {priceLabel} after the clean is completed.</p>
          )}
        </div>

        <Button onClick={submit} disabled={busy} className="w-full h-11">
          {busy ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : cta}
        </Button>
        {savedCard && payOption !== "pay_after" && (
          <button type="button" disabled={busy} onClick={() => { setBusy(true); checkout(); }} className="w-full text-center text-xs font-medium text-[#5C0FFE] hover:underline disabled:opacity-50">
            Use a different card
          </button>
        )}
        <p className="text-[11px] text-center text-muted-foreground">
          {payOption === "pay_after"
            ? "Charged in full after the cleaner completes the turnover and uploads photos."
            : payOption === "split"
              ? "Half now; the remaining half is charged automatically when the turnover is completed."
              : "Your turnover is confirmed once payment succeeds, then we assign your cleaning crew."}
        </p>
      </div>
    </Modal>
  );
}

// ─── Overview building blocks ──────────────────────────────────────────────
function KpiTile({ icon: Icon, label, value, sub }: { icon: typeof RiDashboardLine; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-3.5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide font-semibold text-slate-500">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-violet-50 text-[#5C0FFE]"><Icon className="w-3.5 h-3.5" /></span>
          {label}
        </div>
        <p className="text-2xl font-bold mt-1.5 text-slate-900">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function QuickAction({ icon: Icon, label, onClick }: { icon: typeof RiDashboardLine; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 text-left transition hover:border-[#5C0FFE]/40 hover:shadow-sm">
      <span className="flex items-center gap-2.5 text-sm font-medium text-slate-800">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-[#5C0FFE]"><Icon className="w-4 h-4" /></span>
        {label}
      </span>
      <RiArrowRightUpLine className="w-4 h-4 text-slate-300 group-hover:text-[#5C0FFE]" />
    </button>
  );
}

// ─── Cleaners tab — roster (names only) + per-property crew management ───────
function CleanersTab({
  properties, cleaners, onRequest,
}: {
  properties: Property[];
  cleaners: HostCleaners | null;
  onRequest: (property: Property, current: CrewMember | undefined, kind: "replace" | "additional") => void;
}) {
  const roster = cleaners?.roster || [];
  const rosterMax = cleaners?.rosterMax || 10;
  const perPropertyMax = cleaners?.perPropertyMax || 2;
  return (
    <div className="space-y-6">
      <Card className="border-violet-200 bg-gradient-to-br from-violet-50 to-white">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold flex items-center gap-2"><RiGroupLine className="w-4 h-4 text-[#5C0FFE]" /> Your cleaner roster</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Up to {perPropertyMax} regular cleaners per property · {rosterMax} on your roster. You see first names only — request a change and our team handles vetting & scheduling.</p>
            </div>
            <span className="text-sm font-bold text-[#5C0FFE] shrink-0">{roster.length}/{rosterMax}</span>
          </div>
          {roster.length > 0 ? (
            <div className="flex flex-wrap gap-2 mt-3">
              {roster.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-xs font-medium">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#5C0FFE] text-white text-[10px]">{c.firstName.slice(0, 1).toUpperCase()}</span>
                  {c.firstName}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-3">No cleaners assigned yet — they'll appear here once your first turnover is staffed.</p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-700">Crew by property</h3>
        {properties.length === 0 && <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Add a property first.</CardContent></Card>}
        {properties.map((p) => {
          const crew = cleaners?.byProperty?.[p.id] || [];
          const canAdd = crew.length < perPropertyMax;
          return (
            <Card key={p.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-sm flex items-center gap-2"><RiHome4Line className="w-4 h-4 text-[#5C0FFE]" /> {p.nickname || p.address || "Property"}</p>
                  {crewSizeFor(p) ? <Badge variant="secondary" className="bg-violet-50 text-[#5C0FFE]">{crewSizeFor(p)}-person crew</Badge> : null}
                </div>
                {crew.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {crew.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#5C0FFE] text-white text-[11px]">{c.firstName.slice(0, 1).toUpperCase()}</span>
                          {c.firstName}
                        </span>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onRequest(p, c, "replace")}>
                          <RiExchangeFundsLine className="w-3.5 h-3.5 mr-1" /> Replace
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-2">No regular cleaner yet — we assign one automatically on your next turnover, or request a specific change below.</p>
                )}
                <Button size="sm" variant="ghost" className="mt-2 text-[#5C0FFE]" disabled={!canAdd} onClick={() => onRequest(p, undefined, "additional")}>
                  <RiUserAddLine className="w-3.5 h-3.5 mr-1" /> {canAdd ? "Request an additional cleaner" : `Max ${perPropertyMax} cleaners`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function RequestCleanerModal({
  ctx, onClose, onDone,
}: {
  ctx: { property: Property; current?: CrewMember; kind: "replace" | "additional" };
  onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const isReplace = ctx.kind === "replace";
  const submit = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("host-cleaners", {
      body: {
        action: "cleaner.requestChange",
        kind: ctx.kind,
        propertyId: ctx.property.id,
        currentCleanerId: ctx.current?.id || null,
        reason,
      },
    });
    setBusy(false);
    if (error || (data as { error?: string })?.error) { toast.error((data as { error?: string })?.error || "Could not send request"); return; }
    toast.success("Request sent — our team will sort it out and update your crew.");
    onDone();
  };
  return (
    <Modal onClose={onClose} title={isReplace ? `Replace ${ctx.current?.firstName || "cleaner"}` : "Request another cleaner"}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {isReplace
            ? `We'll find a new cleaner for ${ctx.property.nickname || "this property"} and update your crew. No charge for swapping.`
            : `We'll add another vetted cleaner to ${ctx.property.nickname || "this property"} (up to 2 regulars).`}
        </p>
        <div>
          <Label>Anything we should know? (optional)</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={isReplace ? "e.g. scheduling conflicts, prefer someone for larger crews…" : "e.g. need a 2-person crew for back-to-back turnovers…"} />
        </div>
        <Button onClick={submit} disabled={busy} className="w-full h-11" style={{ background: "#5C0FFE" }}>
          {busy ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Send request to our team"}
        </Button>
      </div>
    </Modal>
  );
}

// ─── Today's photos tab — auto-deletes after 7 days ─────────────────────────
function TodayPhotosTab({ turnovers, propName, todayYmd }: { turnovers: Turnover[]; propName: (id: string) => string; todayYmd: string }) {
  const todays = turnovers.filter((t) => t.requested_date === todayYmd);
  const recent = turnovers.filter((t) => t.requested_date !== todayYmd).slice(0, 12);
  const Group = ({ t }: { t: Turnover }) => {
    const before = t.before_photos || [];
    const after = t.after_photos || [];
    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm flex items-center gap-2"><RiHome4Line className="w-4 h-4 text-[#5C0FFE]" /> {propName(t.property_id)}</p>
            <span className="text-xs text-muted-foreground">{format(new Date(`${t.requested_date}T12:00:00`), "EEE, MMM d")}</span>
          </div>
          {before.length === 0 && after.length === 0 ? (
            <p className="text-xs text-muted-foreground">No photos uploaded yet.</p>
          ) : (
            <>
              {(["Before", "After"] as const).map((label) => {
                const urls = label === "Before" ? before : after;
                if (!urls.length) return null;
                return (
                  <div key={label} className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {urls.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border bg-slate-100">
                          <img src={u} alt={`${label} ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </CardContent>
      </Card>
    );
  };
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
        <RiTimeLine className="w-4 h-4 shrink-0" /> Turnover photos are kept for 7 days, then automatically deleted from the app.
      </div>
      <section className="space-y-3">
        <h2 className="text-base font-bold flex items-center gap-2"><RiImage2Line className="w-4 h-4 text-[#5C0FFE]" /> Today</h2>
        {todays.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No photos for today's turnovers yet.</CardContent></Card>
        ) : todays.map((t) => <Group key={t.id} t={t} />)}
      </section>
      {recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-bold text-slate-700">Recent (last 7 days)</h2>
          {recent.map((t) => <Group key={t.id} t={t} />)}
        </section>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground text-sm">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
