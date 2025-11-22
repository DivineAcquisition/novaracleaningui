import { Home, Briefcase, DollarSign, User } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useNativeHaptics } from "@/hooks/use-native-haptics";

export function MobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { impact } = useNativeHaptics();

  const navItems = [
    { icon: Home, label: "Dashboard", path: "/cleaner/dashboard" },
    { icon: Briefcase, label: "Jobs", path: "/cleaner/job-offers" },
    { icon: DollarSign, label: "Earnings", path: "/cleaner/dashboard" },
    { icon: User, label: "Profile", path: "/cleaner/profile" },
  ];

  const handleNavigation = (path: string) => {
    impact('light');
    navigate(path);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50 safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          
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
