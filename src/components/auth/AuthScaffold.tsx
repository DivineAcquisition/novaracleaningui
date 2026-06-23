"use client";

// ─── Shared premium auth design system ─────────────────────────────────────
//
// One design language for every Novara auth surface (customer, cleaner,
// admin, partner, password recovery). A split-screen layout: an aurora
// brand panel (brand purple #5C0FFE → #8F7BFD, glass value-prop chips,
// tabular-mono trust stats, one signature aurora-drift motion that honors
// prefers-reduced-motion) beside a clean light form surface.
//
// This module is presentation-only. Each page keeps its own auth logic and
// just composes <AuthScaffold> + <AuthCard> around its form.

import * as React from "react";

// Brand tokens — purple used as a scalpel, not a flood.
export const AUTH_GRADIENT = "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)";
export const AUTH_INPUT_CLS =
  "h-11 pl-10 bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 " +
  "focus-visible:border-[#8F7BFD] focus-visible:ring-2 focus-visible:ring-[#8F7BFD]/30";

const LOGO_SRC = "/novara-email-logo.png";

export interface AuthFeature {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  desc: string;
}
export interface AuthStat {
  value: string;
  label: string;
}

// Official multicolor Google "G" so OAuth buttons read as authentic.
export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

// The single signature motion for the surface — a slow aurora drift.
// Scoped via unique animation names; disabled under prefers-reduced-motion.
function AuroraMotionStyle() {
  return (
    <style>{`
@keyframes nvAuthDriftA{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(30px,-24px,0)}}
@keyframes nvAuthDriftB{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(-26px,20px,0)}}
.nv-auth-a{animation:nvAuthDriftA 14s ease-in-out infinite}
.nv-auth-b{animation:nvAuthDriftB 18s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.nv-auth-a,.nv-auth-b{animation:none}}
`}</style>
  );
}

function BrandPanel({
  headline,
  subline,
  features,
  stats,
}: {
  headline: React.ReactNode;
  subline: string;
  features: AuthFeature[];
  stats: AuthStat[];
}) {
  return (
    <div className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between" style={{ background: "#0B0920" }}>
      <AuroraMotionStyle />
      {/* Aurora wash + drifting glows + faint masked grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(55% 45% at 16% 12%, rgba(143,123,253,.55), transparent 60%)," +
              "radial-gradient(45% 40% at 90% 18%, rgba(171,158,253,.32), transparent 60%)," +
              "radial-gradient(70% 65% at 78% 98%, rgba(92,15,254,.55), transparent 62%)",
          }}
        />
        <div className="nv-auth-a absolute -left-24 top-8 h-80 w-80 rounded-full blur-3xl" style={{ background: "rgba(143,123,253,.45)" }} />
        <div className="nv-auth-b absolute -bottom-10 right-0 h-96 w-96 rounded-full blur-3xl" style={{ background: "rgba(92,15,254,.45)" }} />
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
        <img src={LOGO_SRC} alt="Novara Cleaning" className="h-8 w-auto" style={{ filter: "brightness(0) invert(1)" }} />
      </div>

      {/* Headline + value props */}
      <div className="relative max-w-md">
        <h2 className="font-jakarta text-3xl font-bold leading-[1.15] tracking-tight xl:text-[2.6rem]">{headline}</h2>
        <p className="mt-4 text-sm leading-relaxed text-white/70">{subline}</p>
        {features.length > 0 && (
          <ul className="mt-9 space-y-5">
            {features.map((f) => (
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
        )}
      </div>

      {/* Trust stats — tabular mono numerals */}
      {stats.length > 0 ? (
        <div className="relative flex items-center gap-9">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight">{s.value}</p>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-white/45">{s.label}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="relative" />
      )}
    </div>
  );
}

/**
 * Premium split-screen auth shell. Pass the brand-panel content (headline,
 * value props, trust stats) and render the form as children — it lands on
 * the clean right-hand surface, with a compact brand header on mobile.
 */
export function AuthScaffold({
  eyebrow,
  headline,
  subline,
  features = [],
  stats = [],
  children,
}: {
  eyebrow: string;
  headline: React.ReactNode;
  subline: string;
  features?: AuthFeature[];
  stats?: AuthStat[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full bg-[#FAFAFC] lg:grid lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel headline={headline} subline={subline} features={features} stats={stats} />
      <div className="relative flex min-h-screen items-center justify-center px-5 py-12 sm:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-40 lg:hidden"
          style={{ background: "radial-gradient(80% 100% at 50% 0%, rgba(92,15,254,.10), transparent 70%)" }}
        />
        <div className="relative w-full max-w-[400px] space-y-8">
          <div className="flex flex-col items-center gap-2 lg:hidden">
            <img src={LOGO_SRC} alt="Novara Cleaning" className="h-7 w-auto" />
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">{eyebrow}</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The clean glass form card that sits on the right surface. */
export function AuthCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200/70 bg-white p-7 shadow-[0_1px_3px_rgba(16,24,40,0.06),0_18px_50px_-20px_rgba(79,56,255,0.25)] ${className}`}>
      {children}
    </div>
  );
}

export default AuthScaffold;
