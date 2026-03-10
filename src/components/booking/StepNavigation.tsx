"use client";

import {
  RiCheckLine
} from "@remixicon/react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface Step {
  number: number;
  label: string;
  path: string;
}

interface StepNavigationProps {
  currentStep: number;
  steps: Step[];
}

const STEP_ROUTES: Record<number, string> = {
  1: "/book/zip",
  2: "/book/sqft",
  3: "/book/offer",
  4: "/book/checkout",
  5: "/book/details",
  6: "/book/confirmation"
};

export function StepNavigation({ currentStep, steps }: StepNavigationProps) {
  const router = useRouter();

  const handleStepClick = (stepNumber: number) => {
    // Only allow navigation to completed steps (steps before current)
    if (stepNumber < currentStep) {
      const route = STEP_ROUTES[stepNumber];
      if (route) {
        router.push(route);
      }
    }
  };

  return (
    <div className="hidden md:block w-full max-w-4xl mx-auto px-4 py-6">
      <div className="relative">
        {/* Progress Line Background */}
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-border" />
        
        {/* Active Progress Line */}
        <div
          className="absolute top-5 left-0 h-0.5 bg-primary transition-all duration-500 ease-out"
          style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
        />

        {/* Steps */}
        <div className="relative flex justify-between">
          {steps.map((step) => {
            const isCompleted = currentStep > step.number;
            const isCurrent = currentStep === step.number;
            const isClickable = isCompleted;

            return (
              <button
                key={step.number}
                onClick={() => handleStepClick(step.number)}
                disabled={!isClickable}
                className={cn(
                  "flex flex-col items-center group transition-all duration-200",
                  isClickable && "cursor-pointer",
                  !isClickable && "cursor-default"
                )}
                aria-label={isClickable ? `Go back to ${step.label}` : step.label}
              >
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all duration-300 border-2",
                    isCompleted && "bg-primary text-primary-foreground border-primary",
                    isCompleted && "group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-primary/25",
                    isCurrent && "bg-primary text-primary-foreground border-primary ring-4 ring-primary/20",
                    !isCompleted && !isCurrent && "bg-muted text-muted-foreground border-muted"
                  )}
                >
                  {isCompleted ? (
                    <RiCheckLine className="w-5 h-5" />
                  ) : (
                    step.number
                  )}
                </div>
                <span
                  className={cn(
                    "mt-2 text-xs font-medium text-center transition-colors duration-200",
                    isCompleted && "text-primary group-hover:text-primary/80",
                    isCurrent && "text-foreground font-semibold",
                    !isCompleted && !isCurrent && "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
                {isClickable && (
                  <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                    Click to edit
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
