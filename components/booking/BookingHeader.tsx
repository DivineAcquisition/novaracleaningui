"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

interface BookingHeaderProps {
  currentStep: number;
  totalSteps: number;
  stepLabel?: string;
}

export function BookingHeader({ currentStep, totalSteps, stepLabel }: BookingHeaderProps) {
  const progressPercent = Math.round((currentStep / totalSteps) * 100);

  return (
    <div className="w-full bg-background/95 backdrop-blur-sm border-b border-border sticky top-0 z-50">
      <div className="container max-w-6xl mx-auto px-4 py-4">
        {/* Top Row: Logo and Actions */}
        <div className="flex items-center justify-between mb-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <i className="ri-sparkling-2-fill text-white text-lg"></i>
            </div>
            <span className="font-semibold text-lg hidden sm:block">NovaraCleaning</span>
          </Link>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 sm:gap-3">
            <Link 
              href="/"
              className="inline-flex items-center justify-center rounded-full gap-1 sm:gap-2 h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm border border-border hover:bg-muted transition-colors"
            >
              <i className="ri-global-line text-sm"></i>
              <span className="hidden xs:inline">Website</span>
            </Link>
            <a 
              href="tel:+19725590223"
              className="inline-flex items-center justify-center rounded-full gap-1 sm:gap-2 h-8 sm:h-9 px-2 sm:px-3 text-xs sm:text-sm border border-border hover:bg-muted transition-colors"
            >
              <i className="ri-phone-line text-sm"></i>
              <span className="hidden xs:inline">Call</span>
            </a>
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
