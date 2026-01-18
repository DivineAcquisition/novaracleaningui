/**
 * BentoGrid - Modern bento-style grid layout for features
 */

import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface BentoGridProps {
  children: ReactNode;
  className?: string;
}

export function BentoGrid({ children, className }: BentoGridProps) {
  return (
    <div className={cn(
      "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6",
      className
    )}>
      {children}
    </div>
  );
}

interface BentoCardProps {
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
  gradient?: boolean;
  hover?: boolean;
}

export function BentoCard({ 
  children, 
  className, 
  size = "md",
  gradient = false,
  hover = true 
}: BentoCardProps) {
  const sizeClasses = {
    sm: "",
    md: "md:col-span-1",
    lg: "md:col-span-2",
  };

  return (
    <div className={cn(
      "relative overflow-hidden rounded-2xl md:rounded-3xl border bg-card p-6 md:p-8",
      sizeClasses[size],
      gradient && "bg-gradient-to-br from-white to-purple-50/50 dark:from-gray-900 dark:to-purple-950/20",
      hover && "transition-all duration-300 hover:shadow-xl hover:shadow-purple-500/10 hover:border-[#5500FF]/30",
      className
    )}>
      {children}
    </div>
  );
}
