/**
 * GlassCard - Glassmorphism card with backdrop blur
 */

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./card";

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
}

export function GlassCard({ children, className, hover = true, glow = false }: GlassCardProps) {
  return (
    <Card 
      className={cn(
        "bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl border-white/20 dark:border-gray-800/50",
        hover && "transition-all duration-300 hover:shadow-xl hover:shadow-[#5500FF]/10 hover:-translate-y-1",
        glow && "shadow-lg shadow-[#5500FF]/20",
        className
      )}
    >
      {children}
    </Card>
  );
}

export function GlassCardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <CardHeader className={className}>{children}</CardHeader>;
}

export function GlassCardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <CardContent className={className}>{children}</CardContent>;
}

export { CardTitle as GlassCardTitle, CardDescription as GlassCardDescription };
