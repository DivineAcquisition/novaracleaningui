"use client";

import { useEffect, useState } from "react";
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
  const [choice, setChoice] = useState<StoredCookieChoice | null>(null);
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [advertising, setAdvertising] = useState(false);
  const version = bannerVersion();
  const summary = wordingByKind(SEEDED_WORDING, "cookie_banner")?.body || "";

  useEffect(() => {
    const stored = readStoredCookieChoice();
    if (stored) {
      setChoice(stored);
      setAnalytics(stored.analytics);
      setAdvertising(stored.advertising);
      setOpen(false);
      return;
    }
    if (gpcOn()) {
      const declined: StoredCookieChoice = {
        essential: true,
        analytics: false,
        advertising: false,
        gpc: true,
        source: "gpc",
        bannerVersion: version,
        chosenAt: new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      };
      persist(declined);
      setChoice(declined);
      setOpen(false);
      return;
    }
    setOpen(true);
  }, [version]);

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
    setChoice(next);
    setOpen(false);
    setManage(false);
  };

  const stamp = (partial: Pick<StoredCookieChoice, "analytics" | "advertising" | "source">): StoredCookieChoice => ({
    essential: true,
    analytics: partial.analytics,
    advertising: partial.advertising,
    gpc: gpcOn(),
    source: partial.source,
    bannerVersion: version,
    chosenAt: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });

  if (!open) return null;

  const buttonClass =
    "h-11 flex-1 rounded-md border border-foreground/20 bg-background px-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div className="fixed inset-x-0 bottom-0 z-[80] p-3 md:p-4" role="dialog" aria-labelledby="cookie-notice-title">
      <div className="mx-auto max-w-3xl rounded-xl border border-border bg-background p-4 shadow-lg">
        <h2 id="cookie-notice-title" className="text-sm font-semibold text-foreground">
          Cookies
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
        {choice?.gpc ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Your browser sent Global Privacy Control, so optional cookies stay off unless you accept them here.
          </p>
        ) : null}
        {manage ? (
          <div className="mt-3 space-y-2 text-sm">
            <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <span>Essential (booking, security, payments). Always on.</span>
              <input type="checkbox" checked disabled aria-label="Essential cookies always on" />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <span>Analytics</span>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(event) => setAnalytics(event.target.checked)}
                aria-label="Analytics cookies"
                className="h-5 w-5"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <span>Advertising and tracking</span>
              <input
                type="checkbox"
                checked={advertising}
                onChange={(event) => setAdvertising(event.target.checked)}
                aria-label="Advertising and tracking cookies"
                className="h-5 w-5"
              />
            </label>
          </div>
        ) : null}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button type="button" className={buttonClass} onClick={() => save(stamp({ analytics: false, advertising: false, source: "decline" }))}>
            Decline
          </button>
          <button type="button" className={buttonClass} onClick={() => setManage((value) => !value)}>
            Manage preferences
          </button>
          {manage ? (
            <button
              type="button"
              className={buttonClass}
              onClick={() => save(stamp({ analytics, advertising, source: "custom" }))}
            >
              Save choices
            </button>
          ) : (
            <button type="button" className={buttonClass} onClick={() => save(stamp({ analytics: true, advertising: true, source: "accept" }))}>
              Accept
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function openCookieSettings() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COOKIE_OPEN_EVENT));
}
