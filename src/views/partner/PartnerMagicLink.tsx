"use client";

import { useState } from "react";
import { RiLoader4Line, RiMailLine, RiShieldCheckLine } from "@remixicon/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEO } from "@/components/SEO";

const PURPLE_GRADIENT = "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)";

export default function PartnerMagicLink({ notice }: { notice?: string | null }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!email.includes("@")) {
      toast.error("Enter the email on your partnership.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/partner-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok && json?.ok !== true) {
        throw new Error(json?.message || "Could not send the link.");
      }
      setSent(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <SEO title="Partner portal sign-in" noindex />
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <img src="/novara-logo.png" alt="Novara Cleaning" className="mx-auto h-8" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Partner portal</h1>
          <p className="mt-1 text-sm text-slate-500">
            Hosts and commercial clients sign in here with a one-time email link. No password is ever created.
          </p>
        </div>
        {notice && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>
        )}
        {sent ? (
          <div className="space-y-3 text-center">
            <RiShieldCheckLine className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="font-semibold text-slate-900">Check your email</p>
            <p className="text-sm text-slate-500">
              If we have a partnership on this address, a short-lived sign-in link is on its way — optionally by text
              as well. The link signs you in without a password.
            </p>
            <button className="text-sm font-medium text-[#5C0FFE]" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Email
              <div className="relative mt-1">
                <RiMailLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="h-11 pl-10"
                  onKeyDown={(e) => e.key === "Enter" && void submit()}
                />
              </div>
            </label>
            <Button
              className="h-11 w-full text-white"
              style={{ background: PURPLE_GRADIENT }}
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : "Email me a sign-in link"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
