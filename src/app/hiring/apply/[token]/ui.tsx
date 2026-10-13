"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApplicantTypeform } from "@/components/hiring/ApplicantTypeform";
import type { PublicHiringSession } from "@/lib/hiring/session";

export function TokenizedApply({ token }: { token: string }) {
  const [session, setSession] = useState<PublicHiringSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/hiring/session/${token}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          session?: PublicHiringSession;
        };
        if (cancelled) return;
        if (!res.ok || !data.session) {
          setError(data.error || "This application link is not valid.");
          return;
        }
        setSession(data.session);
      } catch {
        if (!cancelled) setError("This application link is unavailable right now.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#F7F5FC] px-6 text-center">
        <h1 className="font-heading text-3xl font-extrabold text-slate-900">Link unavailable</h1>
        <p className="mt-3 max-w-md text-slate-600">{error}</p>
        <Link href="/hiring" className="mt-6 text-sm font-semibold text-[#5C0FFE]">
          Back to careers
        </Link>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#F7F5FC] text-sm font-medium text-slate-500">
        Opening your application…
      </div>
    );
  }

  return <ApplicantTypeform session={session} />;
}
