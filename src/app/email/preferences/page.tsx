"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

type Category = { id: string; label: string };

function PreferencesInner() {
  const params = useSearchParams();
  const token = params?.get("t") || "";
  const withdrawTax = params?.get("tax") === "1";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("not_asked");
  const [categories, setCategories] = useState<Category[]>([]);
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("This link is missing its token.");
      return;
    }
    fetch(`/api/email/preferences?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok || body.ok === false) throw new Error(body.error || "This link is not valid.");
        setEmail(body.email || "");
        setStatus(body.status || "not_asked");
        setCategories(body.categories || []);
        const initial: Record<string, boolean> = {};
        for (const category of body.categories || []) {
          initial[category.id] = body.choices ? body.choices[category.id] !== false : true;
        }
        setChoices(initial);
        if (withdrawTax) {
          const withdrawn = await fetch("/api/email/preferences", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ t: token, withdrawTax: true }),
          });
          const out = await withdrawn.json();
          if (!withdrawn.ok || out.ok === false) throw new Error(out.error || "Could not withdraw consent.");
          setNote("You withdrew consent for electronic tax forms. Future forms go by paper. Forms already sent stay as they were.");
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "This link is not valid."));
  }, [token, withdrawTax]);

  const save = async (resubscribe = false) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/email/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resubscribe ? { t: token, resubscribe: true } : { t: token, categories: choices }),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error(body.error || "Could not save.");
      setNote(resubscribe
        ? "You are subscribed to marketing email again. Text messages were not changed."
        : "Preferences saved. Messages about bookings, payments, and your account continue either way. Text messages were not changed.");
      if (resubscribe) setStatus("subscribed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-16 text-zinc-800">
      <div className="mx-auto max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-violet-800">Novara Cleaning</p>
        <h1 className="mt-2 text-2xl font-semibold">Email preferences</h1>
        <p className="mt-3 text-sm leading-6">
          {email ? <>Choices for {email}. </> : null}
          Service messages about bookings, payments, and your account continue either way. Changing email preferences does not change text messages.
        </p>
        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
        {note ? <p className="mt-4 text-sm text-emerald-800">{note}</p> : null}
        {status === "unsubscribed" ? (
          <Button className="mt-6" disabled={busy} onClick={() => void save(true)}>Resubscribe to marketing email</Button>
        ) : (
          <div className="mt-6 space-y-3">
            {categories.map((category) => (
              <label key={category.id} className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={choices[category.id] !== false}
                  onChange={(event) => setChoices({ ...choices, [category.id]: event.target.checked })}
                />
                <span>{category.label}</span>
              </label>
            ))}
            <Button disabled={busy || !token} onClick={() => void save(false)}>Save preferences</Button>
          </div>
        )}
      </div>
    </main>
  );
}

export default function PreferencesPage() {
  return (
    <Suspense>
      <PreferencesInner />
    </Suspense>
  );
}
