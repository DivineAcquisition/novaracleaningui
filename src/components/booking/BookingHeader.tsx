import { Globe, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BookingHeaderProps {
  currentStep: number;
  totalSteps: number;
  stepLabel?: string;
}

export function BookingHeader({ currentStep, totalSteps, stepLabel }: BookingHeaderProps) {
  const progressPercent = Math.round((currentStep / totalSteps) * 100);

  return (
    <div className="w-full bg-background border-b border-border">
      <div className="container max-w-6xl mx-auto px-4 py-4">
        {/* Top Row: Logo and Actions */}
        <div className="flex items-center justify-between mb-4">
          {/* Logo */}
          <div className="flex items-center">
            <img 
              src="/novara-logo.png" 
              alt="Novara" 
              className="h-12 w-12 rounded-lg object-contain"
            />
          </div>

          {/* Action Buttons */}
          <div className="hidden sm:flex items-center gap-3">
            <Button 
              variant="outline" 
              size="sm"
              className="rounded-full gap-2"
              onClick={() => window.open('/', '_blank')}
            >
              <Globe className="w-4 h-4" />
              Visit Website
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              className="rounded-full gap-2"
              asChild
            >
              <a href="tel:+19725590223">
                <Phone className="w-4 h-4" />
                (972) 559-0223
              </a>
            </Button>
          </div>
        </div>

        {/* Step Indicator Row */}
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-foreground">
            <span className="font-semibold">Step {currentStep}</span>
            <span className="text-muted-foreground"> of {totalSteps}</span>
            {stepLabel && (
              <span className="text-muted-foreground ml-2">— {stepLabel}</span>
            )}
          </div>
          <div className="text-sm font-semibold text-primary">
            {progressPercent}%
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div 
            className={cn(
              "h-full rounded-full transition-all duration-500 ease-out",
              "bg-gradient-to-r from-primary via-primary to-primary/80"
            )}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
