import { redirect } from "next/navigation";

// Sync health is now a tab of the Operations hub. Airtable sync alerts link
// here by URL, so the old path has to keep resolving.
export default function Page() {
  redirect("/admin/operations?tab=sync");
}

export const dynamic = "force-dynamic";
