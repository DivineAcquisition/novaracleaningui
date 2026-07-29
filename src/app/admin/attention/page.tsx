import { redirect } from "next/navigation";

// Needs Attention is now a tab of the Operations hub. Old bookmarks and the
// links inside already-sent Discord alerts land in the right place.
export default function Page() {
  redirect("/admin/operations?tab=attention");
}

export const dynamic = "force-dynamic";
