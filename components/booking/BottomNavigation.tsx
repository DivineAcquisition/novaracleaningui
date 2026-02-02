"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavigationProps {
  currentStep: number;
  totalSteps: number;
  onBack?: () => void;
  onContinue?: () => void;
  continueText?: string;
  continueDisabled?: boolean;
  showPrice?: boolean;
  price?: number;
  steps: Array<{ number: number; label: string }>;
}

export function BottomNavigation({
  currentStep,
  totalSteps,
  onBack,
  onContinue,
  continueText = "Continue",
  continueDisabled = false,
  showPrice = false,
  price = 0,
  steps,
}: BottomNavigationProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 md:hidden bg-background border-t border-border shadow-lg z-50 animate-slide-up safe-bottom">
      
      {/* Navigation Buttons */}
      <div className="flex gap-2 p-3">
        {onBack && (
          <Button
            variant="outline"
            size="lg"
            onClick={onBack}
            className="flex-shrink-0 h-12 w-12 p-0"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
        )}
        {onContinue && (
          <Button
            size="lg"
            onClick={onContinue}
            disabled={continueDisabled}
            className="flex-1 h-12 text-base font-semibold"
          >
            {continueText}
            <ArrowRight className="ml-2 w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
