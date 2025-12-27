import { Phone, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BookingProgressBarProps {
  currentStep: number;
  totalSteps: number;
}

export function BookingProgressBar({ currentStep, totalSteps }: BookingProgressBarProps) {
  const progress = (currentStep / totalSteps) * 100;

  return (
    <div className="bg-card border-b border-border sticky top-0 z-50">
      <div className="container max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <img 
              src="/novara-logo.png" 
              alt="Novara Cleaning" 
              className="h-8 w-auto"
            />
          </div>

          {/* Contact buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              asChild
            >
              <a href="tel:+14155550123">
                <Phone className="h-4 w-4" />
                <span className="text-sm">(415) 555-0123</span>
              </a>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden text-muted-foreground hover:text-foreground"
              asChild
            >
              <a href="tel:+14155550123">
                <Phone className="h-4 w-4" />
              </a>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              asChild
            >
              <a href="https://novaracleaning.com" target="_blank" rel="noopener noreferrer">
                <Globe className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
            <span>Step {currentStep} of {totalSteps}</span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
