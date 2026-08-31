import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { consumeLoginToken } from "@/lib/partner-portal/handoff";
import { isLocalHost } from "@/lib/partner-portal/origins";
import { previewKindFromToken } from "@/lib/partner-portal/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PartnerEnterPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const host = (await headers()).get("host") || "";
  const preview = previewKindFromToken(token);
  if (preview && isLocalHost(host)) {
    redirect(`/partner?preview=${preview}`);
  }

  const result = await consumeLoginToken(token);
  if (!result.ok) {
    redirect(`/partner?link=${encodeURIComponent(result.message || "invalid")}`);
  }
  redirect("/partner");
}
