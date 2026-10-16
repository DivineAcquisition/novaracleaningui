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

  const buttonClass =
    "h-11 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2";

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="cookie-notice-title">
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-2xl">
        <h2 id="cookie-notice-title" className="text-lg font-semibold">
          Cookie choices
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">{summary}</p>
        {gpc ? (
          <p className="mt-2 text-sm text-zinc-600">
            Your browser sent Global Privacy Control, so analytics and advertising stay off unless you accept them here.
          </p>
        ) : null}
        {manage ? (
          <div className="mt-4 space-y-2 text-sm">
            <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3">
              <span>Essential. Booking, security, and payments. Always on.</span>
              <input type="checkbox" checked disabled aria-label="Essential cookies always on" />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3">
              <span>Analytics</span>
              <input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} aria-label="Analytics cookies" className="h-5 w-5" />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3">
              <span>Advertising and tracking</span>
              <input type="checkbox" checked={advertising} onChange={(event) => setAdvertising(event.target.checked)} aria-label="Advertising and tracking cookies" className="h-5 w-5" />
            </label>
          </div>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" className={buttonClass} onClick={() => save(stamp({ analytics: false, advertising: false, source: "decline" }))}>
            Decline
          </button>
          <button type="button" className={buttonClass} onClick={() => setManage((value) => !value)}>
            Manage preferences
          </button>
          {manage ? (
            <button type="button" className={buttonClass} onClick={() => save(stamp({ analytics, advertising, source: "custom" }))}>
              Save choices
            </button>
          ) : (
            <button type="button" className={buttonClass} onClick={() => save(stamp({ analytics: true, advertising: true, source: "accept" }))}>
              Accept
            </button>
          )}
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
