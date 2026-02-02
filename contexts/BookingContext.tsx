"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface BookingData {
  zipCode: string;
  homeSizeId: string;
  serviceType: string;
  addOns: string[];
  membershipPlan: string;
  useCredit: boolean;
  serviceDate: string;
  timeSlot: string;
  startTime?: string;
  endTime?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  serviceDuration: number;
  customerId?: string;
  addressId?: string;
  paymentOption: 'deposit' | 'full';
  bedrooms?: number;
  bathrooms?: number;
  dwellingType?: string;
  bookingId?: string;
  referralCode?: string;
  promoCode?: string;
}

interface BookingContextType {
  bookingData: BookingData;
  updateBookingData: (data: Partial<BookingData>) => void;
  resetBookingData: () => void;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  totalSteps: number;
}

const initialBookingData: BookingData = {
  zipCode: '',
  homeSizeId: '',
  serviceType: '',
  addOns: [],
  membershipPlan: 'none',
  useCredit: false,
  serviceDate: '',
  timeSlot: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  serviceDuration: 0,
  paymentOption: 'deposit',
};

const BookingContext = createContext<BookingContextType | undefined>(undefined);

export function BookingProvider({ children }: { children: React.ReactNode }) {
  const [bookingData, setBookingData] = useState<BookingData>(initialBookingData);
  const [currentStep, setCurrentStep] = useState(1);
  const [isHydrated, setIsHydrated] = useState(false);
  const totalSteps = 6;

  // Load from localStorage after hydration
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bookingData');
      if (saved) {
        try {
          setBookingData(JSON.parse(saved));
        } catch (e) {
          console.error('Failed to parse booking data:', e);
        }
      }
      setIsHydrated(true);
    }
  }, []);

  // Save to localStorage when data changes (after hydration)
  useEffect(() => {
    if (isHydrated && typeof window !== 'undefined') {
      localStorage.setItem('bookingData', JSON.stringify(bookingData));
    }
  }, [bookingData, isHydrated]);

  const updateBookingData = (data: Partial<BookingData>) => {
    setBookingData(prev => ({ ...prev, ...data }));
  };

  const resetBookingData = () => {
    setBookingData(initialBookingData);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('bookingData');
    }
    setCurrentStep(1);
  };

  return (
    <BookingContext.Provider
      value={{
        bookingData,
        updateBookingData,
        resetBookingData,
        currentStep,
        setCurrentStep,
        totalSteps,
      }}
    >
      {children}
    </BookingContext.Provider>
  );
}

export function useBooking() {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error('useBooking must be used within BookingProvider');
  }
  return context;
}
