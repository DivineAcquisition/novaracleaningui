/**
 * GradientBlob - Decorative animated gradient blob for SaaS aesthetics
 */

import { cn } from "@/lib/utils";

interface GradientBlobProps {
  className?: string;
  color?: "purple" | "blue" | "pink" | "green";
  size?: "sm" | "md" | "lg" | "xl";
  animate?: boolean;
}

const colorVariants = {
  purple: "from-[#5500FF]/20 to-[#8F7BFD]/20",
  blue: "from-blue-400/20 to-cyan-400/20",
  pink: "from-pink-400/20 to-rose-400/20",
  green: "from-emerald-400/20 to-teal-400/20",
};

const sizeVariants = {
  sm: "w-48 h-48",
  md: "w-72 h-72",
  lg: "w-96 h-96",
  xl: "w-[500px] h-[500px]",
};

export function GradientBlob({ 
  className, 
  color = "purple", 
  size = "md",
  animate = true 
}: GradientBlobProps) {
  return (
    <div 
      className={cn(
        "absolute rounded-full bg-gradient-to-br blur-3xl pointer-events-none",
        colorVariants[color],
        sizeVariants[size],
        animate && "animate-pulse",
        className
      )} 
    />
  );
}
