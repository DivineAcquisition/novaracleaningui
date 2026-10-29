"use client";

import { useEffect, useState } from "react";
import { RiLoader4Line } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import {
  AsideNote,
  ChecklistShell,
  ScopeRoom,
  countItems,
} from "@/components/checklists/ChecklistPages";

interface Section {
  title: string;
  items: string[];
}

interface ChecklistPayload {
  heading: string;
  intro: string;
  firstName: string;
  bookingNumber: string | null;
  visit: {
    serviceDate: string | null;
    arrivalWindow: string | null;
    address: string | null;
    home: string | null;
    frequency: string | null;
  };
  yourAddOns: string[];
  notes: Array<{ label: string; value: string }>;
  sections: Section[];
  extras: string[];
}

export default function MyChecklistPage({ token }: { token: string }) {
  const [checklist, setChecklist] = useState<ChecklistPayload | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("customer-checklist", { body: { token } });
        if (cancelled) return;
        if (error || !data?.ok) {
          setReason(data?.reason || "not_found");
          return;
        }
        setChecklist(data.checklist as ChecklistPayload);
      } catch {
        if (!cancelled) setReason("not_found");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!checklist && !reason) {
    return (
      <ChecklistShell>
        <div className="flex min-h-[50vh] items-center justify-center">
          <RiLoader4Line className="h-8 w-8 animate-spin text-primary" />
        </div>
      </ChecklistShell>
    );
  }

  if (!checklist) {
    const copy = reason === "expired"
      ? "This checklist link has expired."
      : reason === "cancelled"
        ? "This booking was cancelled, so the checklist is no longer available."
        : "This checklist link is not valid.";
    return (
      <ChecklistShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <h1 className="font-jakarta text-2xl font-bold">Checklist unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy}</p>
        </div>
      </ChecklistShell>
    );
  }

  const facts = [
    checklist.bookingNumber && ["Booking", checklist.bookingNumber],
    checklist.visit.serviceDate && ["Date", checklist.visit.serviceDate],
    checklist.visit.arrivalWindow && ["Arrival", checklist.visit.arrivalWindow],
    checklist.visit.address && ["Address", checklist.visit.address],
    checklist.visit.home && ["Home", checklist.visit.home],
    checklist.visit.frequency && ["Frequency", checklist.visit.frequency],
  ].filter(Boolean) as Array<[string, string]>;
  const total = countItems(checklist.sections);

  return (
    <ChecklistShell>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-primary" />
        <div className="relative container mx-auto max-w-3xl px-4 py-12 text-white md:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">Your visit</p>
          <h1 className="mt-2 font-jakarta text-4xl font-extrabold tracking-tight">Hi {checklist.firstName}</h1>
          <p className="mt-3 text-lg text-white/90">{checklist.heading}</p>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/75">{checklist.intro}</p>
          {facts.length > 0 && (
            <div className="mt-8 grid gap-2 sm:grid-cols-2">
              {facts.map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{label}</p>
                  <p className="mt-0.5 text-sm font-medium">{value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="container mx-auto max-w-3xl space-y-4 px-4 py-10">
        <div>
          <h2 className="font-jakarta text-2xl font-bold tracking-tight">On the list</h2>
          <p className="mt-1 text-sm text-muted-foreground">{total} lines for this visit.</p>
        </div>
        {checklist.yourAddOns.length > 0 && (
          <AsideNote tone="add" title="Added to your visit" items={checklist.yourAddOns} />
        )}
        {checklist.notes.map((note) => (
          <section key={note.label} className="rounded-3xl border border-border/70 bg-card p-5 shadow-card">
            <h2 className="font-jakarta text-lg font-bold">{note.label}</h2>
            <p className="mt-2 text-sm leading-relaxed text-foreground/90">{note.value}</p>
          </section>
        ))}
        {checklist.sections.map((section, index) => (
          <ScopeRoom
            key={section.title}
            id={`area-${index + 1}`}
            index={index + 1}
            title={section.title}
            items={section.items}
          />
        ))}
        {checklist.extras.length > 0 && (
          <AsideNote tone="warn" title="Not included, unless you add them" items={checklist.extras} />
        )}
      </div>
    </ChecklistShell>
  );
}
