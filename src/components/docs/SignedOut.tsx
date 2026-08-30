import { RiLockLine } from "@remixicon/react";

import { DocsSignIn } from "@/components/docs/DocsSignIn";
import type { DocsDenialReason } from "@/lib/docs/auth";
import { DOCS_SIGN_OUT } from "@/lib/docs/paths";

// Shown instead of any documentation content when the reader has not passed
// the admin gate. It deliberately says nothing about what the guides contain
// beyond the fact that they are internal.
//
// Sign-in happens HERE, on the docs host. The admin workspace session lives
// on admin.novaracleaning.com and is invisible to this origin — sending
// people there and back can never unlock the guides.

const MESSAGES: Record<string, { title: string; body: string }> = {
  signed_out: {
    title: "Sign in to read the workspace guides",
    body: "Use your @novaracleaning.com admin or VA account. A session on the admin workspace does not unlock this site — each host keeps its own sign-in.",
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

export function SignedOut({
  reason,
  flash,
}: {
  reason: DocsDenialReason;
  flash?: DocsDenialReason | null;
}) {
  const shown = flash && flash !== "signed_out" ? flash : reason;
  const { title, body } = MESSAGES[shown] ?? MESSAGES.signed_out;
  const showForm = reason === "signed_out";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 font-sans">
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--hairline)] bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-primary">
          <RiLockLine className="h-5 w-5" />
        </div>
        <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
        {showForm ? (
          <DocsSignIn />
        ) : (
          <form action={DOCS_SIGN_OUT} method="post" className="mt-6">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Sign out and try a different account
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
