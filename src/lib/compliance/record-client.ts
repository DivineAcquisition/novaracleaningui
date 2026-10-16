"use client";

import {
  buildAcceptanceRecord,
  type AcceptanceContext,
  type AcceptanceKind,
  type NewAcceptanceInput,
  type RenderedAcceptance,
  type Surface,
} from "@/lib/compliance";

const STASH_KEY = "novara.compliance.checkout";

export function stashCheckoutAcceptances(payload: {
  checked: Partial<Record<AcceptanceKind, boolean>>;
  items: RenderedAcceptance[];
}) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STASH_KEY, JSON.stringify(payload));
}

export function readCheckoutAcceptances(): {
  checked: Partial<Record<AcceptanceKind, boolean>>;
  items: RenderedAcceptance[];
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STASH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { checked: Partial<Record<AcceptanceKind, boolean>>; items: RenderedAcceptance[] };
  } catch {
    return null;
  }
}

export async function submitAcceptances(input: {
  surface: Surface;
  context: AcceptanceContext;
  items: RenderedAcceptance[];
  checked: Partial<Record<AcceptanceKind, boolean>>;
  personName?: string | null;
  email?: string | null;
  phone?: string | null;
  bookingId?: string | null;
  agreementId?: string | null;
  chargeId?: string | null;
}): Promise<void> {
  const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  const records = input.items
    .filter((item) => input.checked[item.kind] === true)
    .map((item) => {
      const draft: NewAcceptanceInput = {
        item,
        surface: input.surface,
        acceptedAt: new Date().toISOString(),
        timeZone: "UTC",
        deviceTimeZone,
        ip: "",
        userAgent: navigator.userAgent,
        personName: input.personName,
        email: input.email,
        phone: input.phone,
        bookingId: input.bookingId,
        agreementId: input.agreementId,
        chargeId: input.chargeId,
        relationship: input.context.relationship,
        propertyLabel: input.context.propertyLabel,
        amountBasis: input.context.charge?.amountBasis || null,
      };
      return buildAcceptanceRecord(draft, `${item.kind}-${Date.now()}`);
    });
  if (!records.length) return;
  await fetch("/api/compliance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "record_acceptances",
      records,
      deviceTimeZone,
      userAgent: navigator.userAgent,
    }),
  });
}

export async function submitSignedCopy(input: {
  email: string;
  bookingId?: string | null;
  lines: string[];
}): Promise<void> {
  await fetch("/api/compliance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "signed_copy", ...input }),
  });
}
