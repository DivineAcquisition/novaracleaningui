"use client";

import { useRouter } from "next/navigation";
import {
  RiBriefcaseLine,
  RiDashboardLine,
  RiGraduationCapLine,
  RiHome4Line,
  RiNotification3Line,
  RiUserLine,
} from "@remixicon/react";

import { WorkspaceShell } from "@/components/chrome/WorkspaceShell";
import { TourLauncher } from "@/components/tour/TourLauncher";
import { TourProvider } from "@/components/tour/TourProvider";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { TOUR } from "@/lib/tours/anchors";

export function ContractorLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/cleaner/auth");
  };

  const navItems = [
    { title: "Dashboard", url: "/cleaner/dashboard", icon: RiDashboardLine, description: "Jobs · pay · status", tourAnchor: TOUR.navDashboard },
    { title: "Offers", url: "/cleaner/job-offers", icon: RiNotification3Line, description: "Accept or decline", tourAnchor: TOUR.navOffers },
    { title: "Job lookup", url: "/contractor/jobs", icon: RiBriefcaseLine, description: "Check in · complete", tourAnchor: TOUR.navJobLookup },
    { title: "Turnovers", url: "/cleaner/turnovers", icon: RiHome4Line, description: "Airbnb · STR" },
    { title: "Profile", url: "/cleaner/profile", icon: RiUserLine, description: "Payouts · notifications", tourAnchor: TOUR.navProfile },
    { title: "Training", url: "/cleaner/training", icon: RiGraduationCapLine, description: "Playbooks · checklists", tourAnchor: TOUR.navTraining },
  ];

  return (
    <TourProvider>
      <WorkspaceShell
        badge="Contractor"
        navItems={navItems}
        userLabel={user?.email || null}
        userSub={user?.email}
        onSignOut={handleSignOut}
        cta={<TourLauncher />}
      >
        {children}
      </WorkspaceShell>
    </TourProvider>
  );
}
