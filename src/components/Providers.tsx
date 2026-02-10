"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { BookingProvider } from "@/contexts/BookingContext";
import { DomainRouter } from "@/components/auth/DomainRouter";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
          <BookingProvider>
            <DomainRouter>
              {children}
            </DomainRouter>
          </BookingProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
