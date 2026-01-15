"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Progress } from "@/components/ui/progress";
import { Sparkles, Phone } from "lucide-react";

const steps = [
  { path: "/try", label: "Start", step: 0 },
  { path: "/try/sqft", label: "Home Size", step: 1 },
  { path: "/try/offer", label: "Service", step: 2 },
  { path: "/try/checkout", label: "Checkout", step: 3 },
  { path: "/try/details", label: "Details", step: 4 },
  { path: "/try/confirmation", label: "Confirmed", step: 5 },
];

export default function TryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  
  // Landing page has no progress bar
  const isLandingPage = pathname === "/try" || pathname === "/try/";
  const isCustomQuote = pathname?.includes("/custom-quote");
  
  const currentStep = steps.find((s) => s.path === pathname)?.step || 0;
  const progress = currentStep > 0 ? (currentStep / (steps.length - 1)) * 100 : 0;

  if (isLandingPage || isCustomQuote) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/try" className="flex items-center gap-2">
              <Sparkles className="h-7 w-7 text-primary" />
              <span className="text-xl font-bold text-primary">NovaraCleaning</span>
            </Link>
            
            <a
              href="tel:+1234567890"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <Phone className="h-4 w-4" />
              <span className="hidden sm:inline">(123) 456-7890</span>
            </a>
          </div>

          {/* Progress bar */}
          {currentStep > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                <span>Step {currentStep} of {steps.length - 1}</span>
                <span>{Math.round(progress)}% complete</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          )}
        </div>
      </header>

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
