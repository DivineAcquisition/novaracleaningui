"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
  sessionId?: string;
}

interface BookingContextType {
  bookingData: BookingData;
  updateBookingData: (data: Partial<BookingData>) => void;
  resetBookingData: () => void;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  totalSteps: number;
  sessionId: string | null;
  createSession: (zipCode: string) => Promise<string | null>;
  syncSession: (step?: string) => Promise<void>;
  resumeSession: (id: string) => Promise<boolean>;
  completeSession: (bookingId: string) => Promise<void>;
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

const STEP_MAP: Record<number, string> = {
  1: 'zip',
  2: 'sqft',
  3: 'offer',
  4: 'checkout',
  5: 'details',
  6: 'confirmation',
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
  
  const [currentStep, setCurrentStep] = useState(1);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('booking_session_id');
  });
  const totalSteps = 6;
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localStorage.setItem('bookingData', JSON.stringify(bookingData));
  }, [bookingData]);

  useEffect(() => {
    if (sessionId) {
      localStorage.setItem('booking_session_id', sessionId);
    } else {
      localStorage.removeItem('booking_session_id');
    }
  }, [sessionId]);

  const updateBookingData = useCallback((data: Partial<BookingData>) => {
    setBookingData(prev => ({ ...prev, ...data }));
  }, []);

  const resetBookingData = useCallback(() => {
    setBookingData(initialBookingData);
    setSessionId(null);
    localStorage.removeItem('bookingData');
    localStorage.removeItem('booking_session_id');
    setCurrentStep(1);
  }, []);

  const createSession = useCallback(async (zipCode: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase
        .from('booking_sessions')
        .insert({
          zip_code: zipCode,
          current_step: 'zip',
          status: 'active',
        })
        .select('id')
        .single();

      if (error || !data) {
        console.error('Failed to create session:', error);
        return null;
      }

      setSessionId(data.id);
      updateBookingData({ sessionId: data.id });
      return data.id;
    } catch (err) {
      console.error('Session creation error:', err);
      return null;
    }
  }, [updateBookingData]);

  const syncSession = useCallback(async (step?: string) => {
    const sid = sessionId || bookingData.sessionId;
    if (!sid) return;

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(async () => {
      try {
        const updatePayload: Record<string, any> = {
          updated_at: new Date().toISOString(),
          current_step: step || STEP_MAP[currentStep] || 'zip',
          zip_code: bookingData.zipCode || null,
          email: bookingData.email || null,
          phone: bookingData.phone || null,
          first_name: bookingData.firstName || null,
          last_name: bookingData.lastName || null,
          home_size_id: bookingData.homeSizeId || null,
          service_type: bookingData.serviceType || null,
          add_ons: bookingData.addOns || [],
          membership_plan: bookingData.membershipPlan || 'none',
          use_credit: bookingData.useCredit || false,
          service_date: bookingData.serviceDate || null,
          time_slot: bookingData.timeSlot || null,
          service_duration: bookingData.serviceDuration || null,
          payment_option: bookingData.paymentOption || 'deposit',
          address: bookingData.address || null,
          city: bookingData.city || null,
          state: bookingData.state || null,
          bedrooms: bookingData.bedrooms || null,
          bathrooms: bookingData.bathrooms || null,
          dwelling_type: bookingData.dwellingType || null,
          referral_code: bookingData.referralCode || null,
          promo_code: bookingData.promoCode || null,
        };

        await supabase
          .from('booking_sessions')
          .update(updatePayload)
          .eq('id', sid)
          .eq('status', 'active');
      } catch (err) {
        console.error('Session sync error:', err);
      }
    }, 500);
  }, [sessionId, bookingData, currentStep]);

  const resumeSession = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { data: session, error } = await supabase
        .from('booking_sessions')
        .select('*')
        .eq('id', id)
        .eq('status', 'active')
        .single();

      if (error || !session) {
        console.error('Session not found or expired:', error);
        return false;
      }

      if (new Date(session.expires_at) < new Date()) {
        await supabase
          .from('booking_sessions')
          .update({ status: 'expired' })
          .eq('id', id);
        return false;
      }

      const restoredData: Partial<BookingData> = {
        sessionId: session.id,
        zipCode: session.zip_code || '',
        email: session.email || '',
        phone: session.phone || '',
        firstName: session.first_name || '',
        lastName: session.last_name || '',
        homeSizeId: session.home_size_id || '',
        serviceType: session.service_type || '',
        addOns: session.add_ons || [],
        membershipPlan: session.membership_plan || 'none',
        useCredit: session.use_credit || false,
        serviceDate: session.service_date || '',
        timeSlot: session.time_slot || '',
        serviceDuration: session.service_duration || 0,
        paymentOption: (session.payment_option as 'deposit' | 'full') || 'deposit',
        address: session.address || undefined,
        city: session.city || undefined,
        state: session.state || undefined,
        bedrooms: session.bedrooms || undefined,
        bathrooms: session.bathrooms || undefined,
        dwellingType: session.dwelling_type || undefined,
        referralCode: session.referral_code || undefined,
        promoCode: session.promo_code || undefined,
      };

      setBookingData(prev => ({ ...prev, ...restoredData }));
      setSessionId(session.id);

      const stepEntry = Object.entries(STEP_MAP).find(
        ([, v]) => v === session.current_step
      );
      if (stepEntry) {
        setCurrentStep(parseInt(stepEntry[0]));
      }

      return true;
    } catch (err) {
      console.error('Session resume error:', err);
      return false;
    }
  }, []);

  const completeSession = useCallback(async (bookingId: string) => {
    const sid = sessionId || bookingData.sessionId;
    if (!sid) return;

    try {
      await supabase
        .from('booking_sessions')
        .update({
          status: 'completed',
          booking_id: bookingId,
          current_step: 'confirmation',
          updated_at: new Date().toISOString(),
        })
        .eq('id', sid);

      await supabase
        .from('bookings')
        .update({ session_id: sid })
        .eq('id', bookingId);
    } catch (err) {
      console.error('Session complete error:', err);
    }
  }, [sessionId, bookingData.sessionId]);

  return (
    <BookingContext.Provider
      value={{
        bookingData,
        updateBookingData,
        resetBookingData,
        currentStep,
        setCurrentStep,
        totalSteps,
        sessionId,
        createSession,
        syncSession,
        resumeSession,
        completeSession,
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
