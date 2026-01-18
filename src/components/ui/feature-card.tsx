/**
 * FeatureCard - Enhanced feature card with icon and hover effects
 */

import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { Badge } from "./badge";

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
  className?: string;
  iconClassName?: string;
  variant?: "default" | "gradient" | "outline";
}

export function FeatureCard({ 
  icon: Icon, 
  title, 
  description, 
  badge,
  className,
  iconClassName,
  variant = "default"
}: FeatureCardProps) {
  const variants = {
    default: "bg-card border-2 hover:border-[#5500FF]/50",
    gradient: "bg-gradient-to-br from-white to-purple-50/50 border hover:shadow-lg",
    outline: "bg-transparent border-2 border-dashed hover:border-solid hover:border-[#5500FF]/50",
  };

  return (
    <div className={cn(
      "group relative overflow-hidden rounded-2xl p-6 transition-all duration-300 hover:shadow-xl hover:-translate-y-1",
      variants[variant],
      className
    )}>
      {/* Hover gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#5500FF]/5 to-[#8F7BFD]/5 opacity-0 group-hover:opacity-100 transition-opacity" />
      
      <div className="relative">
        <div className={cn(
          "w-12 h-12 md:w-14 md:h-14 rounded-xl md:rounded-2xl bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center mb-4 shadow-lg shadow-[#5500FF]/25 group-hover:scale-110 transition-transform",
          iconClassName
        )}>
          <Icon className="w-6 h-6 md:w-7 md:h-7 text-white" />
        </div>
        
        {badge && (
          <Badge className="mb-3 bg-[#5500FF]/10 text-[#5500FF] border-0">
            {badge}
          </Badge>
        )}
        
        <h3 className="text-lg md:text-xl font-semibold mb-2">{title}</h3>
        <p className="text-sm md:text-base text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
