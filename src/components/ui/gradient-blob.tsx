/**
 * GradientBlob - Decorative animated gradient blob for SaaS aesthetics
 */

import { cn } from "@/lib/utils";

interface GradientBlobProps {
  className?: string;
  color?: "brand" | "purple" | "blue" | "pink" | "green";
  size?: "sm" | "md" | "lg" | "xl";
  animate?: boolean;
}

// Brand purple: #5500FF to #8F7BFD
const colorVariants = {
  brand: "from-[#5500FF]/20 to-[#8F7BFD]/20",
  purple: "from-[#5500FF]/20 to-[#8F7BFD]/20", // Same as brand
  blue: "from-[#5500FF]/15 to-blue-400/15",    // Purple-tinted blue
  pink: "from-[#8F7BFD]/20 to-pink-400/15",    // Purple-tinted pink
  green: "from-emerald-400/15 to-[#5500FF]/10", // Subtle purple accent
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
