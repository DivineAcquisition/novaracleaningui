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
  const [bookingData, setBookingData] = useState<BookingData>(() => {
    const saved = localStorage.getItem('bookingData');
    return saved ? JSON.parse(saved) : initialBookingData;
  });
  
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 6;

  useEffect(() => {
    localStorage.setItem('bookingData', JSON.stringify(bookingData));
  }, [bookingData]);

  const updateBookingData = (data: Partial<BookingData>) => {
    setBookingData(prev => ({ ...prev, ...data }));
  };

  const resetBookingData = () => {
    setBookingData(initialBookingData);
    localStorage.removeItem('bookingData');
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
