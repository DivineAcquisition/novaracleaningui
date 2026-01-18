import { CheckCircle, Shield, ShieldCheck } from "lucide-react";
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
          "bg-violet-50 border border-violet-200",
          "dark:bg-violet-950/30 dark:border-violet-800",
          className
        )}
        aria-label="Google Guaranteed business"
      >
        <ShieldCheck className="w-4 h-4 text-[#5500FF] dark:text-[#8F7BFD]" />
        <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">
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
          "bg-gradient-to-br from-violet-50 to-violet-100/50 border border-violet-200",
          "dark:from-violet-950/40 dark:to-violet-900/20 dark:border-violet-800",
          className
        )}
        aria-label="Google Guaranteed business"
      >
        <div className="flex items-center gap-2">
          <div className="relative">
            <Shield className="w-8 h-8 text-[#5500FF] dark:text-[#8F7BFD]" />
            <CheckCircle className="w-4 h-4 text-white bg-[#5500FF] rounded-full absolute -bottom-0.5 -right-0.5" />
          </div>
          <span className="text-base font-bold text-violet-700 dark:text-violet-300">
            Google Guaranteed
          </span>
        </div>
        <p className="text-xs text-violet-600/80 dark:text-violet-400/80 text-center">
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
        "bg-violet-50 border border-violet-200",
        "dark:bg-violet-950/30 dark:border-violet-800",
        className
      )}
      aria-label="Google Guaranteed business"
    >
      <div className="relative">
        <Shield className="w-5 h-5 text-[#5500FF] dark:text-[#8F7BFD]" />
        <CheckCircle className="w-2.5 h-2.5 text-white bg-[#5500FF] rounded-full absolute -bottom-0.5 -right-0.5" />
      </div>
      <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">
        Google Guaranteed
      </span>
    </div>
  );
}
