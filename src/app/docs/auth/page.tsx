import { redirect } from "next/navigation";

import { SignedOut } from "@/components/docs/SignedOut";
import { getDocsAccess } from "@/lib/docs/auth";
import { docsFlash } from "@/lib/docs/flash";
import { DOCS_HOME } from "@/lib/docs/paths";

export const dynamic = "force-dynamic";

export default async function DocsAuthPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const access = await getDocsAccess();
  if (access.allowed) redirect(DOCS_HOME);
  return (
    <SignedOut reason={access.reason ?? "signed_out"} flash={docsFlash(searchParams.error)} />
  );
}
