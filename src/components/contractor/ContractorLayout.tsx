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
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export function ContractorLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/cleaner/auth");
  };

  const navItems = [
    { title: "Dashboard", url: "/cleaner/dashboard", icon: RiDashboardLine, description: "Jobs · pay · status" },
    { title: "Offers", url: "/cleaner/job-offers", icon: RiNotification3Line, description: "Accept or decline" },
    { title: "Job lookup", url: "/contractor/jobs", icon: RiBriefcaseLine, description: "Check in · complete" },
    { title: "Turnovers", url: "/cleaner/turnovers", icon: RiHome4Line, description: "Airbnb · STR" },
    { title: "Profile", url: "/cleaner/profile", icon: RiUserLine, description: "Payouts · notifications" },
    { title: "Training", url: "/cleaner/training", icon: RiGraduationCapLine, description: "Playbooks · checklists" },
  ];

  return (
    <WorkspaceShell
      badge="Contractor"
      navItems={navItems}
      userLabel={user?.email || null}
      userSub={user?.email}
      onSignOut={handleSignOut}
    >
      {children}
    </WorkspaceShell>
  );
}
