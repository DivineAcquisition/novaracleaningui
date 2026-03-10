"use client";


import {
  RiMenuLine,
  RiNotification3Line
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { useNativeHaptics } from "@/hooks/use-native-haptics";

interface MobileHeaderProps {
  title: string;
  showNotifications?: boolean;
  onMenuClick?: () => void;
}

export function MobileHeader({ title, showNotifications = true, onMenuClick }: MobileHeaderProps) {
  const { impact } = useNativeHaptics();

  const handleMenuClick = () => {
    impact('light');
    onMenuClick?.();
  };

  const handleNotificationClick = () => {
    impact('light');
    // Handle notification click
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-background border-b border-border safe-area-top">
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-3">
          {onMenuClick && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleMenuClick}
              className="h-10 w-10"
            >
              <RiMenuLine className="h-5 w-5" />
            </Button>
          )}
          <h1 className="text-lg font-semibold truncate">{title}</h1>
        </div>
        
        {showNotifications && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNotificationClick}
            className="h-10 w-10 relative"
          >
            <RiNotification3Line className="h-5 w-5" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-destructive rounded-full" />
          </Button>
        )}
      </div>
    </header>
  );
}
