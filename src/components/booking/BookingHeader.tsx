import { Globe, Phone, Shield, Star, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface BookingHeaderProps {
  currentStep: number;
  totalSteps: number;
  stepLabel?: string;
}

export function BookingHeader({ currentStep, totalSteps, stepLabel }: BookingHeaderProps) {
  const progressPercent = Math.round((currentStep / totalSteps) * 100);

  return (
    <div className="w-full sticky top-0 z-50">
      {/* Trust Banner */}
      <div className="bg-gradient-to-r from-primary via-primary/95 to-primary text-white">
        <div className="container max-w-6xl mx-auto px-4 py-2">
          <div className="flex items-center justify-center gap-4 text-xs sm:text-sm">
            <div className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              <span className="font-medium">Google Guaranteed</span>
            </div>
            <span className="hidden sm:inline text-white/60">•</span>
            <div className="hidden sm:flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 fill-yellow-300 text-yellow-300" />
              <span>4.9 Rating</span>
            </div>
            <span className="hidden md:inline text-white/60">•</span>
            <div className="hidden md:flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>$60 Off First Clean</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <div className="bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="container max-w-6xl mx-auto px-4 py-3">
          {/* Top Row: Logo and Actions */}
          <div className="flex items-center justify-between mb-3">
            {/* Logo & Brand */}
            <div className="flex items-center gap-3">
              <img 
                src="/novara-logo.png" 
                alt="Novara Cleaning" 
                className="h-10 w-10 rounded-xl object-contain shadow-sm"
              />
              <div className="hidden sm:block">
                <p className="font-semibold text-sm font-jakarta leading-tight">Novara Cleaning</p>
                <p className="text-[10px] text-muted-foreground">Professional Home Cleaning</p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="sm"
                className="rounded-full gap-1.5 h-8 px-3 text-xs hover:bg-primary/10"
                onClick={() => window.open('/', '_blank')}
              >
                <Globe className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Website</span>
              </Button>
              <Button 
                size="sm"
                className="rounded-full gap-1.5 h-8 px-3 text-xs bg-gradient-primary shadow-sm"
                asChild
              >
                <a href="tel:+19725590223">
                  <Phone className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Call Now</span>
                </a>
              </Button>
            </div>
          </div>

          {/* Progress Section */}
          <div className="space-y-2">
            {/* Step Indicator */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge 
                  variant="secondary" 
                  className="bg-primary/10 text-primary text-xs font-semibold px-2 py-0.5"
                >
                  Step {currentStep}/{totalSteps}
                </Badge>
                {stepLabel && (
                  <span className="text-sm font-medium text-foreground">{stepLabel}</span>
                )}
              </div>
              <span className="text-xs font-semibold text-primary">{progressPercent}% Complete</span>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className={cn(
                  "h-full rounded-full transition-all duration-500 ease-out",
                  "bg-gradient-to-r from-primary via-primary to-accent"
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
