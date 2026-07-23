import { Suspense } from "react";
import MembershipBenefits from "@/views/MembershipBenefits";

export const metadata = {
  title: "Glow Membership Benefits | Novara Cleaning",
  description:
    "Everything included with a NovaraCleaning Glow Membership — customer portal access, before & after photo reports, your choice of cleaner, member pricing, priority scheduling, and the 48-hour re-clean guarantee.",
};

export default function Page() {
  return (
    <Suspense>
      <MembershipBenefits />
    </Suspense>
  );
}
