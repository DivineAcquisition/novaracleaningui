"use client";

import { useEffect, useState } from "react";
import { RiCheckboxCircleFill, RiLoader4Line } from "@remixicon/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

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
      <div className="min-h-screen flex items-center justify-center">
        <RiLoader4Line className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!checklist) {
    const copy = reason === "expired"
      ? "This checklist link has expired."
      : reason === "cancelled"
        ? "This booking was cancelled, so the checklist is no longer available."
        : "This checklist link is not valid.";
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center text-muted-foreground">{copy}</CardContent>
        </Card>
      </div>
    );
  }

  const facts = [
    checklist.bookingNumber && ["Booking", checklist.bookingNumber],
    checklist.visit.serviceDate && ["Date", checklist.visit.serviceDate],
    checklist.visit.arrivalWindow && ["Arrival window", checklist.visit.arrivalWindow],
    checklist.visit.address && ["Address", checklist.visit.address],
    checklist.visit.home && ["Home", checklist.visit.home],
    checklist.visit.frequency && ["Frequency", checklist.visit.frequency],
  ].filter(Boolean) as Array<[string, string]>;

  return (
    <div className="min-h-screen bg-gradient-hero py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Hi {checklist.firstName}</p>
          <h1 className="text-3xl font-bold font-jakarta tracking-tight">{checklist.heading}</h1>
          <p className="text-muted-foreground">{checklist.intro}</p>
        </div>

        {facts.length > 0 && (
          <Card>
            <CardContent className="pt-6 grid gap-2">
              {facts.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-right">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {checklist.yourAddOns.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Added to your visit</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {checklist.yourAddOns.map((item) => (
                  <li key={item} className="flex gap-2 text-sm">
                    <RiCheckboxCircleFill className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {checklist.notes.map((note) => (
          <Card key={note.label}>
            <CardHeader>
              <CardTitle className="text-lg">{note.label}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">{note.value}</CardContent>
          </Card>
        ))}

        <div className="grid gap-4">
          {checklist.sections.map((section) => (
            <Card key={section.title}>
              <CardHeader>
                <CardTitle className="text-lg">{section.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {section.items.map((item) => (
                    <li key={item} className="flex gap-2 text-sm">
                      <RiCheckboxCircleFill className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        {checklist.extras.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Not included, unless you add them</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                {checklist.extras.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
