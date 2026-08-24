import { redirect } from "next/navigation";

// Old Partnerships Hub URL. Tab aliases (proposals → pipeline, ops → str,
// commercial → accounts, turnovers → str) are applied by the Commercial hub.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}) {
  const params = await Promise.resolve(searchParams);
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    const v = Array.isArray(value) ? value[0] : value;
    if (v) qs.set(key, v);
  }
  const suffix = qs.toString();
  redirect(suffix ? `/admin/commercial?${suffix}` : "/admin/commercial");
}

export const dynamic = "force-dynamic";
