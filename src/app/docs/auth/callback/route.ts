import { NextRequest } from "next/server";

import { createDocsRouteClient } from "@/lib/docs/route-client";
import { DOCS_HOME } from "@/lib/docs/paths";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const { supabase, redirect } = createDocsRouteClient(request);

  if (!code) return redirect(`${DOCS_HOME}?error=signed_out`);

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return redirect(`${DOCS_HOME}?error=signed_out`);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = String(user?.email || "").trim().toLowerCase();

  if (!user || !email.endsWith("@novaracleaning.com")) {
    await supabase.auth.signOut();
    return redirect(`${DOCS_HOME}?error=wrong_domain`);
  }

  const { data: isAdminOrVa, error: roleError } = await (supabase.rpc as any)("is_admin_or_va", {
    _uid: user.id,
  });
  if (roleError || isAdminOrVa !== true) {
    await supabase.auth.signOut();
    return redirect(`${DOCS_HOME}?error=no_role`);
  }

  return redirect(DOCS_HOME);
}
