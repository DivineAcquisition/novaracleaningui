import { redirect } from "next/navigation";

// The commercial booking workspace merged into the Partnerships Hub
// (Book Service tab). Old bookmarks land in the right place.
export default function Page() {
  redirect("/admin/partner?tab=book");
}

export const dynamic = "force-dynamic";
