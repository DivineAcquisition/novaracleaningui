import { redirect } from "next/navigation";

// Dispatch is now a tab of the Operations hub. The ?job= parameter is carried
// through because dispatch alert emails and Discord messages already in the
// wild deep-link to a specific job card.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const job = Array.isArray(params.job) ? params.job[0] : params.job;
  redirect(`/admin/operations?tab=dispatch${job ? `&job=${encodeURIComponent(job)}` : ""}`);
}

export const dynamic = "force-dynamic";
