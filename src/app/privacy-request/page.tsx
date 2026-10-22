"use client";

import { useState } from "react";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { PRIVACY_REQUESTS_EMAIL } from "@/lib/public-site";

export default function PrivacyRequestPage() {
  const [kind, setKind] = useState<"access" | "correct" | "delete">("access");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ dueOn: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    if (!email.includes("@")) {
      setError("Enter the email on your booking.");
      return;
    }
    const res = await fetch("/api/compliance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "data_request", kind, name, email, phone, details }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Could not save the request.");
      return;
    }
    setDone({ dueOn: json.request.dueOn });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-10">
        <h1 className="text-2xl font-semibold text-foreground">See, correct, or delete your information</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tell us what you want done, or email{" "}
          <a className="underline" href={`mailto:${PRIVACY_REQUESTS_EMAIL}`}>{PRIVACY_REQUESTS_EMAIL}</a>.
          We will reply by the due date. Records required for taxes, a claim, or a payment dispute are kept, and we will say why.
        </p>
        {done ? (
          <p className="mt-6 rounded-md border border-border p-4 text-sm" role="status">
            Request received. Due {done.dueOn}.
          </p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">What do you want?</legend>
              {([
                ["access", "See the information you have about me"],
                ["correct", "Correct something that is wrong"],
                ["delete", "Delete my information"],
              ] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            <label className="block text-sm">
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" autoComplete="name" />
            </label>
            <label className="block text-sm">
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" autoComplete="email" />
            </label>
            <label className="block text-sm">
              Phone (optional)
              <input value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 w-full rounded-md border border-border px-3 py-2" autoComplete="tel" />
            </label>
            <label className="block text-sm">
              Details
              <textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={4} className="mt-1 w-full rounded-md border border-border px-3 py-2" />
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <button type="submit" className="h-11 rounded-md border border-foreground/20 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Submit request
            </button>
          </form>
        )}
      </main>
      <BookingFooter />
    </div>
  );
}
