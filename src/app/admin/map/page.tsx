import { redirect } from "next/navigation";

// The operational map is now a tab of the Operations hub.
export default function Page() {
  redirect("/admin/operations?tab=map");
}

export const dynamic = "force-dynamic";
