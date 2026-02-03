import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  PricingZone,
  getZoneForZipCode,
  calculatePriceWithZone,
  calculateFullPaymentWithDiscount,
  HOME_SIZE_RANGES,
  MEMBERSHIP_PRICES,
  getCleanerAssignment,
} from '@/lib/pricing-system';

export interface UsePricingOptions {
  zipCode?: string;
  homeSizeId?: string;
  serviceType?: string;
  addOns?: string[];
  membershipPlan?: string;
  useCredit?: boolean;
  isNewCustomer?: boolean;
  promoDiscount?: number;
  frequency?: 'one_time' | 'monthly' | 'biweekly' | 'weekly';
}

export interface PricingResult {
  zone: PricingZone;
  basePrice: number;
  zoneAdjustedPrice: number;
  serviceMultiplier: number;
  addOnsTotal: number;
  subtotal: number;
  total: number;
  deposit: number;
  balanceDue: number;
  fullPaymentPrice: number;
  fullPaymentSavings: number;
  membershipPrice?: number;
  membershipSavingsPercent?: number;
  estimatedHours: number;
  cleaners: string;
  isLoading: boolean;
  error: string | null;
}

export function usePricing(options: UsePricingOptions): PricingResult {
  const [zone, setZone] = useState<PricingZone>(getZoneForZipCode(options.zipCode || ''));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch zone from Supabase when ZIP code changes
  useEffect(() => {
    if (!options.zipCode) return;

    const fetchZone = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: fetchError } = await supabase
          .rpc('get_pricing_zone', { p_zip_code: options.zipCode });

        if (fetchError || !data || data.length === 0) {
          // Fallback to local lookup
          setZone(getZoneForZipCode(options.zipCode || ''));
        } else {
          setZone({
            id: data[0].zone_id,
            name: data[0].zone_name,
            modifier: parseFloat(data[0].modifier),
            areas: [],
          });
        }
      } catch (err) {
        console.error('Error fetching zone:', err);
        setZone(getZoneForZipCode(options.zipCode || ''));
      } finally {
        setIsLoading(false);
      }
    };

    fetchZone();
  }, [options.zipCode]);

  // Calculate pricing
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === options.homeSizeId);
  const basePrice = homeSize?.standardPrice || 0;
  const estimatedHours = homeSize?.baseHours || 0;

  // Get cleaner assignment
  const cleanerAssignment = options.homeSizeId && options.serviceType
    ? getCleanerAssignment(options.serviceType, options.homeSizeId)
    : { cleaners: '1' };

  // Calculate with zone modifier
  const pricing = calculatePriceWithZone(
    options.homeSizeId || '',
    options.serviceType || 'standard',
    options.addOns || [],
    options.membershipPlan || 'none',
    options.useCredit || false,
    options.isNewCustomer || false,
    options.promoDiscount || 0,
    options.zipCode
  );

  // Calculate full payment option
  const fullPayment = calculateFullPaymentWithDiscount(
    options.homeSizeId || '',
    options.serviceType || 'standard',
    options.addOns || [],
    options.membershipPlan || 'none',
    options.useCredit || false,
    options.isNewCustomer || false,
    options.promoDiscount || 0,
    options.zipCode
  );

  // Calculate membership price if applicable
  let membershipPrice: number | undefined;
  let membershipSavingsPercent: number | undefined;

  if (options.frequency && options.frequency !== 'one_time' && options.homeSizeId) {
    const membershipPrices = MEMBERSHIP_PRICES[options.frequency as keyof typeof MEMBERSHIP_PRICES];
    if (membershipPrices) {
      const priceInfo = membershipPrices[options.homeSizeId as keyof typeof membershipPrices];
      if (priceInfo) {
        membershipPrice = priceInfo.price;
        // Apply zone modifier to membership price
        membershipPrice = Math.round(membershipPrice * zone.modifier);
        
        // Calculate savings vs one-time
        const oneTimeTotal = pricing.total;
        if (options.frequency === 'monthly') {
          membershipSavingsPercent = Math.round((1 - membershipPrice / oneTimeTotal) * 100);
        } else if (options.frequency === 'biweekly') {
          // Bi-weekly is 2 cleans per month
          const perCleanPrice = membershipPrice / 2;
          membershipSavingsPercent = Math.round((1 - perCleanPrice / oneTimeTotal) * 100);
        } else if (options.frequency === 'weekly') {
          // Weekly is 4 cleans per month
          const perCleanPrice = membershipPrice / 4;
          membershipSavingsPercent = Math.round((1 - perCleanPrice / oneTimeTotal) * 100);
        }
      }
    }
  }

  return {
    zone,
    basePrice,
    zoneAdjustedPrice: Math.round(basePrice * zone.modifier),
    serviceMultiplier: pricing.serviceAddition > 0 ? 1 + (pricing.serviceAddition / pricing.basePrice) : 1,
    addOnsTotal: pricing.addOnsTotal,
    subtotal: pricing.subtotal,
    total: pricing.total,
    deposit: pricing.deposit,
    balanceDue: pricing.balanceDue,
    fullPaymentPrice: fullPayment.finalAmount,
    fullPaymentSavings: fullPayment.savings,
    membershipPrice,
    membershipSavingsPercent,
    estimatedHours,
    cleaners: cleanerAssignment.cleaners,
    isLoading,
    error,
  };
}

/**
 * Hook to get zone information for a ZIP code
 */
export function useZone(zipCode?: string) {
  const [zone, setZone] = useState<PricingZone | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchZone = useCallback(async (zip: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .rpc('get_pricing_zone', { p_zip_code: zip });

      if (fetchError || !data || data.length === 0) {
        setZone(getZoneForZipCode(zip));
      } else {
        setZone({
          id: data[0].zone_id,
          name: data[0].zone_name,
          modifier: parseFloat(data[0].modifier),
          areas: [],
        });
      }
    } catch (err) {
      console.error('Error fetching zone:', err);
      setZone(getZoneForZipCode(zip));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (zipCode && zipCode.length >= 5) {
      fetchZone(zipCode);
    } else {
      setZone(null);
    }
  }, [zipCode, fetchZone]);

  return { zone, isLoading, error, refetch: fetchZone };
}

/**
 * Hook to get all pricing data from Supabase
 */
export function usePricingData() {
  const [zones, setZones] = useState<PricingZone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('pricing_zones')
          .select('*');

        if (fetchError) throw fetchError;

        const zonesData = (data || []).map((z: { id: string; name: string; modifier: string | number; areas: string[] }) => ({
          id: z.id,
          name: z.name,
          modifier: typeof z.modifier === 'string' ? parseFloat(z.modifier) : z.modifier,
          areas: z.areas || [],
        }));

        setZones(zonesData);
      } catch (err) {
        console.error('Error fetching pricing data:', err);
        setError('Failed to load pricing data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  return { zones, isLoading, error };
}
