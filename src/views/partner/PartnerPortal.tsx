"use client";

// ─── partner.novaracleaning.com — Host turnover portal ───────────────────
//
// Self-serve portal for Airbnb / short-term-rental hosts: sign up, register
// properties (admin sets the per-turnover price), request + pay for
// turnovers, and track status. Mobile-first. All pricing/payment/assignment
// is enforced server-side by the partner-turnover edge function.

import { useEffect, useState, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  RiHome4Line, RiAddLine, RiLoader4Line, RiCalendarLine, RiMapPinLine,
  RiLogoutBoxRLine, RiCheckboxCircleLine, RiTimeLine, RiEditLine, RiSparklingLine,
  RiMailSendLine, RiLockLine, RiUser3Line, RiPhoneLine, RiMailLine,
  RiShieldCheckLine, RiArrowRightLine, RiFlashlightFill, RiKey2Line,
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
}
interface Turnover {
  id: string; property_id: string; requested_date: string; window_start: string | null;
  window_end: string | null; price: number; status: string; assignment_type: string | null;
  assigned_cleaner_id: string | null; created_at: string;
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
  return session ? <Dashboard /> : <AuthScreen />;
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
function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [turnovers, setTurnovers] = useState<Turnover[]>([]);
  const [showPropForm, setShowPropForm] = useState(false);
  const [editingProp, setEditingProp] = useState<Property | null>(null);
  const [requestFor, setRequestFor] = useState<Property | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    await supabase.functions.invoke("partner-turnover", { body: { action: "host.ensure" } }).catch(() => {});
    const [{ data: props }, { data: trs }] = await Promise.all([
      (supabase.from as any)("properties").select("*").order("created_at", { ascending: false }),
      (supabase.from as any)("turnover_requests").select("*").order("created_at", { ascending: false }),
    ]);
    setProperties((props as Property[]) || []);
    setTurnovers((trs as Turnover[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const propName = (id: string) => properties.find((p) => p.id === id)?.nickname || properties.find((p) => p.id === id)?.address || "Property";

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO title="Host Dashboard" noindex />
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold"><RiSparklingLine className="w-5 h-5" style={{ color: "#5C0FFE" }} /> Host Portal</div>
          <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}><RiLogoutBoxRLine className="w-4 h-4" /></Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-8">
        {loading ? (
          <div className="flex justify-center py-16"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>
        ) : (
          <>
            {/* Properties */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Your properties</h2>
                <Button size="sm" onClick={() => { setEditingProp(null); setShowPropForm(true); }}>
                  <RiAddLine className="w-4 h-4 mr-1" /> Add property
                </Button>
              </div>
              {properties.length === 0 && <p className="text-sm text-muted-foreground">No properties yet. Add your first rental to request turnovers.</p>}
              <div className="grid gap-3">
                {properties.map((p) => {
                  const priced = p.turnover_price != null && Number(p.turnover_price) > 0;
                  return (
                    <Card key={p.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold flex items-center gap-2"><RiHome4Line className="w-4 h-4 text-primary" /> {p.nickname || "Property"}</p>
                            <p className="text-xs text-muted-foreground truncate">{p.address}</p>
                            <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
                              {p.bedrooms != null && <Badge variant="secondary">{p.bedrooms} BR</Badge>}
                              {p.bathrooms != null && <Badge variant="secondary">{p.bathrooms} BA</Badge>}
                              {p.laundry_included && <Badge variant="secondary">Laundry on-site</Badge>}
                              {p.restock_included && <Badge variant="secondary">Restock</Badge>}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            {priced ? (
                              <p className="font-bold text-primary">${Number(p.turnover_price).toFixed(0)}<span className="text-[11px] text-muted-foreground">/turnover</span></p>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-700">Pending pricing</Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <Button size="sm" variant="outline" onClick={() => { setEditingProp(p); setShowPropForm(true); }}>
                            <RiEditLine className="w-3.5 h-3.5 mr-1" /> Edit
                          </Button>
                          <Button size="sm" disabled={!priced} onClick={() => setRequestFor(p)}>
                            <RiCalendarLine className="w-3.5 h-3.5 mr-1" /> Request turnover
                          </Button>
                        </div>
                        {!priced && <p className="text-[11px] text-amber-600 mt-2">Our team is setting your per-turnover rate — you'll be able to book once it's set.</p>}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>

            {/* Turnover history */}
            <section className="space-y-3">
              <h2 className="text-lg font-bold">Turnovers</h2>
              {turnovers.length === 0 && <p className="text-sm text-muted-foreground">No turnover requests yet.</p>}
              <div className="grid gap-2.5">
                {turnovers.map((t) => {
                  const st = STATUS_LABEL[t.status] || { label: t.status, cls: "bg-slate-100 text-slate-600" };
                  return (
                    <Card key={t.id}>
                      <CardContent className="p-3.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate flex items-center gap-1.5"><RiMapPinLine className="w-3.5 h-3.5 text-primary" />{propName(t.property_id)}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <RiTimeLine className="w-3 h-3" />{format(new Date(`${t.requested_date}T12:00:00`), "EEE, MMM d")}
                            {t.window_start ? ` · ${t.window_start.slice(0,5)}–${(t.window_end||"").slice(0,5)}` : ""}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <Badge className={cn("text-[11px]", st.cls)}>{st.label}</Badge>
                          <p className="text-sm font-semibold mt-1">${Number(t.price).toFixed(0)}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>

      {showPropForm && (
        <PropertyForm property={editingProp} onClose={() => setShowPropForm(false)} onSaved={() => { setShowPropForm(false); load(); }} />
      )}
      {requestFor && (
        <RequestForm property={requestFor} onClose={() => setRequestFor(null)} />
      )}
    </div>
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

// ─── Request turnover (modal → Stripe checkout) ────────────────────────────
function RequestForm({ property, onClose }: { property: Property; onClose: () => void }) {
  const [date, setDate] = useState("");
  const [start, setStart] = useState("11:00");
  const [end, setEnd] = useState("15:00");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!date) { toast.error("Pick a date."); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("partner-turnover", {
      body: { action: "turnover.request", propertyId: property.id, requested_date: date, window_start: start, window_end: end },
    });
    if (error || (data as any)?.error || !(data as any)?.url) {
      setBusy(false);
      toast.error((data as any)?.error || "Could not start checkout");
      return;
    }
    window.location.href = (data as any).url;
  };
  return (
    <Modal onClose={onClose} title={`Request turnover — ${property.nickname || "Property"}`}>
      <div className="space-y-3">
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 flex items-center justify-between">
          <span className="text-sm">Per-turnover price</span>
          <span className="font-bold text-primary">${Number(property.turnover_price).toFixed(0)}</span>
        </div>
        <div><Label>Date *</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Checkout time</Label><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><Label>Next check-in by</Label><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <Button onClick={submit} disabled={busy} className="h-11 w-full">
          {busy ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : `Pay $${Number(property.turnover_price).toFixed(0)} & request`}
        </Button>
        <p className="text-[11px] text-center text-muted-foreground">Your turnover is confirmed once payment succeeds, then we assign your cleaning crew.</p>
      </div>
    </Modal>
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
