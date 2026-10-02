// Prep runs after the business event. A failure here must not fail the booking,
// the signature, the charge, or the job completion.

export function enqueueEvidencePrep(
  admin: { functions: { invoke: (name: string, args: { body: Record<string, unknown> }) => Promise<unknown> } },
  body: Record<string, unknown>,
) {
  const task = Promise.resolve()
    .then(() => admin.functions.invoke("dispute-evidence", { body: { action: "prep", ...body } }))
    .catch((err) => {
      console.log(`[evidence-prep] ${err instanceof Error ? err.message : String(err)}`);
    });
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (work: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  else void task;
}
