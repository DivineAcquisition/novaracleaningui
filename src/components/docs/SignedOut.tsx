import Link from "next/link";
import { RiLockLine } from "@remixicon/react";

import type { DocsDenialReason } from "@/lib/docs/auth";

// Shown instead of any documentation content when the reader has not passed
// the admin gate. It deliberately says nothing about what the guides contain
// beyond the fact that they are internal.

const MESSAGES: Record<string, { title: string; body: string }> = {
  signed_out: {
    title: "Sign in to read the workspace guides",
    body: "These guides use the same sign-in as the admin workspace. Sign in there first, then come back to this page.",
  },
  wrong_domain: {
    title: "Use your Novara account",
    body: "The workspace guides are internal. Sign in with your @novaracleaning.com email rather than a personal account.",
  },
  no_role: {
    title: "You don't have access to the workspace guides",
    body: "These guides are for teammates with admin or VA access to the workspace. Ask an admin if you think you should be able to read them.",
  },
};

export function SignedOut({ reason }: { reason: DocsDenialReason }) {
  const { title, body } = MESSAGES[reason] ?? MESSAGES.signed_out;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 font-sans">
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--hairline)] bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-primary">
          <RiLockLine className="h-5 w-5" />
        </div>
        <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
        <Link
          href="https://admin.novaracleaning.com/admin/auth"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Go to the workspace sign-in
        </Link>
      </div>
    </div>
  );
}
