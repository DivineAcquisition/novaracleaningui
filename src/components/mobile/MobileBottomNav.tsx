"use client";

import {
  RiBriefcaseLine,
  RiHomeLine,
  RiMoneyDollarCircleLine,
  RiUserLine
} from "@remixicon/react";
import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useNativeHaptics } from "@/hooks/use-native-haptics";

export function MobileBottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { impact } = useNativeHaptics();

  const navItems = [
    { icon: RiHomeLine, label: "Dashboard", path: "/cleaner/dashboard" },
    { icon: RiBriefcaseLine, label: "Jobs", path: "/cleaner/job-offers" },
    { icon: RiMoneyDollarCircleLine, label: "Earnings", path: "/cleaner/dashboard" },
    { icon: RiUserLine, label: "Profile", path: "/cleaner/profile" },
  ];

  const handleNavigation = (path: string) => {
    impact('light');
    router.push(path);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.path;
          
          return (
            <button
              key={item.path}
              onClick={() => handleNavigation(item.path)}
              className={cn(
                "flex flex-col items-center justify-center flex-1 h-full space-y-1 transition-colors touch-manipulation",
                "min-w-[44px] min-h-[44px]",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5", isActive && "fill-current")} />
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
