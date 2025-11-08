import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BottomNavigationProps {
  currentStep: number;
  totalSteps: number;
  onBack?: () => void;
  onContinue?: () => void;
  continueDisabled?: boolean;
  continueLabel?: string;
  totalPrice?: number;
  showBack?: boolean;
}

export function BottomNavigation({
  currentStep,
  totalSteps,
  onBack,
  onContinue,
  continueDisabled = false,
  continueLabel = "Continue",
  totalPrice,
  showBack = true,
}: BottomNavigationProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border lg:hidden z-50 animate-slide-up">
      {/* Step Dots */}
      <div className="flex justify-center gap-1.5 py-3">
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              i + 1 === currentStep
                ? "w-8 bg-primary"
                : i + 1 < currentStep
                ? "w-1.5 bg-primary/60"
                : "w-1.5 bg-muted"
            )}
          />
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between gap-3 px-4 pb-4">
        {showBack ? (
          <Button
            variant="outline"
            size="lg"
            onClick={onBack}
            className="flex-1 h-12"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        ) : (
          <div className="flex-1" />
        )}

        <Button
          size="lg"
          onClick={onContinue}
          disabled={continueDisabled}
          className="flex-1 h-12 relative"
        >
          {continueLabel}
          <ArrowRight className="w-4 h-4 ml-2" />
          {totalPrice !== undefined && totalPrice > 0 && (
            <span className="absolute -top-2 -right-2 bg-secondary text-secondary-foreground text-xs font-semibold px-2 py-0.5 rounded-full">
              ${totalPrice}
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
