"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Sparkles, Phone } from "lucide-react";
import { Toaster } from "sonner";

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
  
  const isLandingPage = pathname === "/try" || pathname === "/try/";
  const isCustomQuote = pathname?.includes("/custom-quote");
  
  const currentStep = steps.find((s) => s.path === pathname)?.step || 0;
  const progress = currentStep > 0 ? (currentStep / (steps.length - 1)) * 100 : 0;

  if (isLandingPage || isCustomQuote) {
    return (
      <>
        {children}
        <Toaster position="top-center" richColors />
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <Link href="/try" className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <span className="font-semibold text-primary">NovaraCleaning</span>
          </Link>
          
          <Button variant="ghost" size="sm" asChild>
            <a href="tel:+1234567890" className="gap-2">
              <Phone className="h-4 w-4" />
              <span className="hidden sm:inline">(123) 456-7890</span>
            </a>
          </Button>
        </div>

        {/* Progress bar */}
        {currentStep > 0 && (
          <div className="container pb-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span>Step {currentStep} of {steps.length - 1}</span>
              <span>{Math.round(progress)}% complete</span>
            </div>
            <Progress value={progress} className="h-1" />
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1 container py-8 max-w-3xl">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t py-4">
        <div className="container text-center text-sm text-muted-foreground">
          Questions? Call us at (123) 456-7890 or email support@novaracleaning.com
        </div>
      </footer>
      
      <Toaster position="top-center" richColors />
    </div>
  );
}
