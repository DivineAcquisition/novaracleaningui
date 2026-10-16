"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SEEDED_WORDING, wordingByKind } from "@/lib/compliance";

export const COOKIE_STORAGE_KEY = "novara.cookie.choice.v1";
export const COOKIE_OPEN_EVENT = "novara:cookie-settings";

export interface StoredCookieChoice {
  essential: true;
  analytics: boolean;
  advertising: boolean;
  gpc: boolean;
  source: "accept" | "decline" | "custom" | "gpc";
  bannerVersion: string;
  chosenAt: string;
  timeZone: string;
}

function bannerVersion(): string {
  return wordingByKind(SEEDED_WORDING, "cookie_banner")?.id || "cookie_banner-v1";
}

function gpcOn(): boolean {
  if (typeof navigator === "undefined") return false;
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

export function readStoredCookieChoice(): StoredCookieChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(COOKIE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCookieChoice;
    if (parsed?.essential !== true) return null;
    // A silent Global Privacy Control record is not a choice the person made.
    if (parsed.source === "gpc") return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(choice: StoredCookieChoice) {
  window.localStorage.setItem(COOKIE_STORAGE_KEY, JSON.stringify(choice));
  document.cookie = `novara_cookie=${encodeURIComponent(choice.source)};path=/;max-age=31536000;SameSite=Lax`;
  void fetch("/api/compliance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cookie", choice }),
  }).catch(() => undefined);
  window.dispatchEvent(new CustomEvent("novara:cookie-changed", { detail: choice }));
}

const choiceButton =
  "min-h-10 rounded-xl border border-zinc-200 bg-white px-2 py-2 text-center text-[13px] font-semibold leading-tight text-zinc-900 transition hover:border-[#5C0FFE]/40 hover:bg-[#5C0FFE]/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5C0FFE] focus-visible:ring-offset-2";

function ChoiceRow({
  title,
  detail,
  checked,
  disabled,
  label,
  onChange,
}: {
  title: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
      <span>
        <span className="block text-sm font-medium text-zinc-900">{title}</span>
        <span className="block text-xs leading-4 text-zinc-500">{detail}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={onChange ? (event) => onChange(event.target.checked) : undefined}
        className="h-5 w-5 shrink-0 accent-[#5C0FFE]"
      />
    </label>
  );
}

export function CookieNotice() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [advertising, setAdvertising] = useState(false);
  const version = bannerVersion();
  const summary = wordingByKind(SEEDED_WORDING, "cookie_banner")?.body || "";
  const gpc = mounted && gpcOn();

  useEffect(() => {
    setMounted(true);
    const stored = readStoredCookieChoice();
    if (stored) {
      setAnalytics(stored.analytics);
      setAdvertising(stored.advertising);
      setOpen(false);
      return;
    }
    setOpen(true);
  }, []);

  useEffect(() => {
    const openSettings = () => {
      const stored = readStoredCookieChoice();
      setAnalytics(stored?.analytics === true);
      setAdvertising(stored?.advertising === true);
      setManage(true);
      setOpen(true);
    };
    window.addEventListener(COOKIE_OPEN_EVENT, openSettings);
    return () => window.removeEventListener(COOKIE_OPEN_EVENT, openSettings);
  }, []);

  const save = (next: StoredCookieChoice) => {
    persist(next);
    setOpen(false);
    setManage(false);
  };

  const stamp = (partial: Pick<StoredCookieChoice, "analytics" | "advertising" | "source">): StoredCookieChoice => ({
    essential: true,
    analytics: partial.analytics,
    advertising: partial.advertising,
    gpc,
    source: partial.source,
    bannerVersion: version,
    chosenAt: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });

  if (!mounted || !open || typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex justify-end p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5">
      <div
        role="dialog"
        aria-labelledby="cookie-notice-title"
        className="pointer-events-auto w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 overflow-hidden rounded-2xl border border-[rgba(92,15,254,0.16)] bg-white text-zinc-900 shadow-[0_18px_50px_rgba(36,16,72,0.18)] duration-300"
      >
        <div className="h-1 bg-[linear-gradient(90deg,#5C0FFE,#8F7BFD)]" />
        <div className="p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5C0FFE]/10 text-[#5C0FFE]" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="8" />
                <circle cx="9" cy="10" r="0.8" fill="currentColor" stroke="none" />
                <circle cx="13.5" cy="8.5" r="0.8" fill="currentColor" stroke="none" />
                <circle cx="14" cy="13" r="0.8" fill="currentColor" stroke="none" />
                <circle cx="10" cy="14.5" r="0.8" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5C0FFE]">Novara Cleaning</p>
              <h2 id="cookie-notice-title" className="text-base font-semibold leading-5">
                Cookie choices
              </h2>
            </div>
          </div>
          <p className="mt-3 text-[13px] leading-5 text-zinc-600">{summary}</p>
          {gpc ? (
            <p className="mt-3 rounded-xl bg-[#5C0FFE]/[0.06] px-3 py-2 text-xs leading-5 text-zinc-700">
              Your browser sent Global Privacy Control, so analytics and advertising stay off unless you accept them here.
            </p>
          ) : null}
          {manage ? (
            <div className="mt-3 space-y-2">
              <ChoiceRow title="Essential" detail="Booking, security, and payments. Always on." checked disabled label="Essential cookies always on" />
              <ChoiceRow title="Analytics" detail="How the site is used." checked={analytics} label="Analytics cookies" onChange={setAnalytics} />
              <ChoiceRow title="Advertising" detail="Meta pixel and ad measurement." checked={advertising} label="Advertising and tracking cookies" onChange={setAdvertising} />
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button type="button" className={choiceButton} onClick={() => save(stamp({ analytics: false, advertising: false, source: "decline" }))}>
              Decline
            </button>
            <button type="button" className={choiceButton} aria-label="Manage preferences" onClick={() => setManage((value) => !value)}>
              Manage
            </button>
            {manage ? (
              <button type="button" className={choiceButton} aria-label="Save choices" onClick={() => save(stamp({ analytics, advertising, source: "custom" }))}>
                Save
              </button>
            ) : (
              <button type="button" className={choiceButton} onClick={() => save(stamp({ analytics: true, advertising: true, source: "accept" }))}>
                Accept
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function openCookieSettings() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COOKIE_OPEN_EVENT));
}
