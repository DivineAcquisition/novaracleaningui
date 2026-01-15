import { redirect } from "next/navigation";

// Schedule is now integrated into the offer page
export default function SchedulePage() {
  redirect("/offer");
}
