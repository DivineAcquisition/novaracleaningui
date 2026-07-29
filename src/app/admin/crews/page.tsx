import { redirect } from "next/navigation";

// Crews moved into the cleaner directory (Cleaners → Crews). A crew is a
// property of the people in that directory, so it belongs beside them.
export default function Page() {
  redirect("/admin/cleaners");
}

export const dynamic = "force-dynamic";
