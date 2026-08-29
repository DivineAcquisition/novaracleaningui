"use client";


import {
  RiGlobalLine,
  RiPhoneLine
} from "@remixicon/react";
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
    <div className="w-full bg-background/95 backdrop-blur-xl border-b border-border sticky top-0 z-50 hairline-glow">
      <div className="container max-w-6xl mx-auto px-4 py-4">
        {/* Top Row: Logo and Actions */}
        <div className="flex items-center justify-between mb-4">
          {/* Logo */}
          <div className="flex items-center">
            <img
              src="/novara-logo.png"
              alt="Novara"
              className="h-9 w-9 rounded-lg object-contain sm:h-10 sm:w-10"
            />
          </div>

          {/* Action Buttons - Always visible */}
          <div className="flex items-center gap-2 sm:gap-3">
            <Button 
              variant="outline" 
              size="sm"
              className="rounded-full gap-1 sm:gap-2 h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm"
              onClick={() => window.open('/', '_blank')}
            >
              <RiGlobalLine className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden xs:inline">Website</span>
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              className="rounded-full gap-1 sm:gap-2 h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm"
              asChild
            >
              <a href="tel:+18447352070">
                <RiPhoneLine className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden xs:inline">Call</span>
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
              "bg-gradient-primary"
            )}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
