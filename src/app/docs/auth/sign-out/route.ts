import { NextRequest } from "next/server";

import { createDocsRouteClient } from "@/lib/docs/route-client";
import { DOCS_HOME } from "@/lib/docs/paths";

export const dynamic = "force-dynamic";

async function signOutAndReturn(request: NextRequest) {
  const { supabase, redirect } = createDocsRouteClient(request);
  await supabase.auth.signOut();
  return redirect(DOCS_HOME, 303);
}

export async function POST(request: NextRequest) {
  return signOutAndReturn(request);
}

export async function GET(request: NextRequest) {
  return signOutAndReturn(request);
}
