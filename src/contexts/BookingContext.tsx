"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';

export interface FocusedAreaSelection {
  areaId: string;
  quantity: number;
}

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
  /** Focused / single-area selections (empty for whole-home services). */
  focusedAreas?: FocusedAreaSelection[];
  /** Condition for focused price + duration multipliers. */
  conditionLevel?: 'light' | 'normal' | 'heavy' | 'severe';
  /** Same-day upcharge requested for today's date. */
  isSameDay?: boolean;
  /** ISO timestamp when the customer acknowledged the same-day disclosure. */
  sameDayAcknowledgedAt?: string | null;
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
  focusedAreas: [],
  conditionLevel: 'normal',
  isSameDay: false,
  sameDayAcknowledgedAt: null,
};

const BookingContext = createContext<BookingContextType | undefined>(undefined);

export function BookingProvider({ children }: { children: React.ReactNode }) {
  const [bookingData, setBookingData] = useState<BookingData>(() => {
    if (typeof window === 'undefined') return initialBookingData;
    try {
      const saved = localStorage.getItem('bookingData');
      return saved ? JSON.parse(saved) : initialBookingData;
    } catch {
      return initialBookingData;
    }
  });
  
  const [currentStep, setCurrentStep] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    try {
      const saved = localStorage.getItem('bookingCurrentStep');
      const parsed = saved ? parseInt(saved, 10) : 1;
      return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    } catch {
      return 1;
    }
  });
  const totalSteps = 6;

  useEffect(() => {
    localStorage.setItem('bookingData', JSON.stringify(bookingData));
  }, [bookingData]);

  useEffect(() => {
    localStorage.setItem('bookingCurrentStep', String(currentStep));
  }, [currentStep]);

  const updateBookingData = (data: Partial<BookingData>) => {
    setBookingData(prev => ({ ...prev, ...data }));
  };

  const resetBookingData = () => {
    setBookingData(initialBookingData);
    localStorage.removeItem('bookingData');
    localStorage.removeItem('bookingCurrentStep');
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
