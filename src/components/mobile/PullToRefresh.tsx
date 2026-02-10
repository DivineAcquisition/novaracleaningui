"use client";

import { useState, useRef, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useNativeHaptics } from "@/hooks/use-native-haptics";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: ReactNode;
}

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const { impact } = useNativeHaptics();

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (window.scrollY === 0 && startY.current > 0) {
      const currentY = e.touches[0].clientY;
      const distance = Math.min((currentY - startY.current) * 0.5, 80);
      
      if (distance > 0) {
        setPullDistance(distance);
        setIsPulling(true);
      }
    }
  };

  const handleTouchEnd = async () => {
    if (pullDistance > 60 && !isRefreshing) {
      impact('medium');
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setIsPulling(false);
        setPullDistance(0);
      }
    } else {
      setIsPulling(false);
      setPullDistance(0);
    }
    startY.current = 0;
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="relative"
    >
      {(isPulling || isRefreshing) && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-center transition-all duration-200"
          style={{ 
            height: `${pullDistance}px`,
            opacity: pullDistance / 80 
          }}
        >
          <Loader2 
            className={`h-6 w-6 text-primary ${isRefreshing ? 'animate-spin' : ''}`}
            style={{ transform: `rotate(${pullDistance * 4}deg)` }}
          />
        </div>
      )}
      <div style={{ transform: `translateY(${pullDistance}px)`, transition: isPulling ? 'none' : 'transform 0.2s' }}>
        {children}
      </div>
    </div>
  );
}
