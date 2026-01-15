"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, createContext, useContext, ReactNode } from "react";

// Booking context to persist data across the flow
interface BookingData {
  zipCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  sqftTier: string;
  serviceType: string;
  offerType: "deep_clean" | "membership";
  serviceDate: string;
  timeSlot: string;
  promoCode: string;
  address: string;
  city: string;
  state: string;
  bedrooms: number;
  bathrooms: number;
  dwellingType: string;
  pets: string;
  flooringType: string;
  accessNotes: string;
  paymentOption: "deposit" | "full";
  referralCode: string;
}

interface BookingContextType {
  bookingData: Partial<BookingData>;
  setBookingData: (data: Partial<BookingData>) => void;
  updateBookingData: (updates: Partial<BookingData>) => void;
  clearBookingData: () => void;
}

const BookingContext = createContext<BookingContextType | undefined>(undefined);

export function useBooking() {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error("useBooking must be used within Providers");
  }
  return context;
}

function BookingProvider({ children }: { children: ReactNode }) {
  const [bookingData, setBookingDataState] = useState<Partial<BookingData>>({});

  const setBookingData = (data: Partial<BookingData>) => {
    setBookingDataState(data);
  };

  const updateBookingData = (updates: Partial<BookingData>) => {
    setBookingDataState((prev) => ({ ...prev, ...updates }));
  };

  const clearBookingData = () => {
    setBookingDataState({});
  };

  return (
    <BookingContext.Provider
      value={{ bookingData, setBookingData, updateBookingData, clearBookingData }}
    >
      {children}
    </BookingContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BookingProvider>{children}</BookingProvider>
    </QueryClientProvider>
  );
}
