
import {
  RiCheckboxCircleLine,
  RiShieldCheckLine,
  RiShieldLine
} from "@remixicon/react";
import { cn } from "@/lib/utils";

interface GoogleGuaranteedBadgeProps {
  variant?: "compact" | "standard" | "full";
  className?: string;
}

export function GoogleGuaranteedBadge({ 
  variant = "standard", 
  className 
}: GoogleGuaranteedBadgeProps) {
  if (variant === "compact") {
    return (
      <div 
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full",
          "bg-emerald-50 border border-emerald-200",
          "dark:bg-emerald-950/30 dark:border-emerald-800",
          className
        )}
        aria-label="Google Guaranteed business"
      >
        <RiShieldCheckLine className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          Google Guaranteed
        </span>
      </div>
    );
  }

  if (variant === "full") {
    return (
      <div 
        className={cn(
          "inline-flex flex-col items-center gap-2 px-6 py-4 rounded-xl",
          "bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200",
          "dark:from-emerald-950/40 dark:to-emerald-900/20 dark:border-emerald-800",
          className
        )}
        aria-label="Google Guaranteed business"
      >
        <div className="flex items-center gap-2">
          <div className="relative">
            <RiShieldLine className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            <RiCheckboxCircleLine className="w-4 h-4 text-white bg-emerald-600 rounded-full absolute -bottom-0.5 -right-0.5" />
          </div>
          <span className="text-base font-bold text-emerald-700 dark:text-emerald-300">
            Google Guaranteed
          </span>
        </div>
        <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80 text-center">
          Backed by Google • Up to $2,000 coverage
        </p>
      </div>
    );
  }

  // Standard variant (default)
  return (
    <div 
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2 rounded-lg",
        "bg-emerald-50 border border-emerald-200",
        "dark:bg-emerald-950/30 dark:border-emerald-800",
        className
      )}
      aria-label="Google Guaranteed business"
    >
      <div className="relative">
        <RiShieldLine className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        <RiCheckboxCircleLine className="w-2.5 h-2.5 text-white bg-emerald-600 rounded-full absolute -bottom-0.5 -right-0.5" />
      </div>
      <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
        Google Guaranteed
      </span>
    </div>
  );
}
