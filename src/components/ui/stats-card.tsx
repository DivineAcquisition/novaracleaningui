/**
 * StatsCard - Animated stats display card
 */

import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { AnimatedCounter } from "./animated-counter";

interface StatsCardProps {
  value: number | string;
  label: string;
  icon?: LucideIcon;
  prefix?: string;
  suffix?: string;
  className?: string;
  animated?: boolean;
  variant?: "default" | "gradient" | "outline";
}

export function StatsCard({ 
  value, 
  label, 
  icon: Icon,
  prefix = "",
  suffix = "",
  className,
  animated = true,
  variant = "default"
}: StatsCardProps) {
  const variants = {
    default: "bg-card/50 backdrop-blur border",
    gradient: "bg-gradient-to-br from-[#5500FF]/10 to-[#8F7BFD]/10 border-[#5500FF]/20",
    outline: "bg-transparent border-2",
  };

  const isNumeric = typeof value === "number";

  return (
    <div className={cn(
      "rounded-xl md:rounded-2xl p-4 md:p-6 text-center transition-all duration-300 hover:shadow-lg hover:-translate-y-1",
      variants[variant],
      className
    )}>
      {Icon && (
        <Icon className="w-5 h-5 md:w-6 md:h-6 mx-auto mb-2 md:mb-3 text-[#5500FF]" />
      )}
      <div className="text-2xl md:text-3xl lg:text-4xl font-bold mb-1">
        {isNumeric && animated ? (
          <AnimatedCounter value={value} prefix={prefix} suffix={suffix} />
        ) : (
          <span>{prefix}{value}{suffix}</span>
        )}
      </div>
      <div className="text-xs md:text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

interface StatsRowProps {
  children: React.ReactNode;
  className?: string;
}

export function StatsRow({ children, className }: StatsRowProps) {
  return (
    <div className={cn(
      "grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4",
      className
    )}>
      {children}
    </div>
  );
}
