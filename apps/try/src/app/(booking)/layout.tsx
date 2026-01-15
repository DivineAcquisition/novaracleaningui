"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Progress } from "@/components/ui/progress";
import { Sparkles, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const steps = [
  { path: "/sqft", label: "Home Size", step: 1 },
  { path: "/offer", label: "Service", step: 2 },
  { path: "/schedule", label: "Schedule", step: 3 },
  { path: "/checkout", label: "Checkout", step: 4 },
  { path: "/details", label: "Details", step: 5 },
  { path: "/confirmation", label: "Confirmed", step: 6 },
];

export default function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const currentStep = steps.find((s) => s.path === pathname)?.step || 1;
  const progress = (currentStep / steps.length) * 100;
  const previousStep = steps.find((s) => s.step === currentStep - 1);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <Sparkles className="h-7 w-7 text-primary" />
              <span className="text-xl font-bold text-primary">NovaraCleaning</span>
            </Link>
            
            <div className="hidden md:flex items-center gap-2">
              {steps.slice(0, -1).map((step) => (
                <div
                  key={step.path}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                    step.step === currentStep
                      ? "bg-primary text-white"
                      : step.step < currentStep
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-medium">
                    {step.step}
                  </span>
                  <span className="hidden lg:inline">{step.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-4">
            <Progress value={progress} className="h-1.5" />
          </div>
        </div>
      </header>

      {/* Back button on mobile */}
      {previousStep && currentStep < 6 && (
        <div className="md:hidden px-4 py-2">
          <Link href={previousStep.path}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>
      )}

      {/* Main content */}
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t bg-white/50 py-4">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          Questions? Call us at (123) 456-7890 or email support@novaracleaning.com
        </div>
      </footer>
    </div>
  );
}
