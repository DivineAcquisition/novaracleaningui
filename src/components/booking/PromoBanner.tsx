"use client";

import {
  RiCloseLine
} from "@remixicon/react";
import { useState, useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
interface PromoBannerProps {
  className?: string;
}
export function PromoBanner({
  className
}: PromoBannerProps) {
  const [promos, setPromos] = useState<Array<{
    code: string;
    value: number;
    type: string;
    expires_at: string | null;
  }>>([]);
  const [currentPromoIndex, setCurrentPromoIndex] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  useEffect(() => {
    const fetchPromos = async () => {
      const {
        data
      } = await supabase.from('promo_codes').select('code, value, type, expires_at').eq('active', true).order('value', {
        ascending: false
      }).limit(3);
      if (data && data.length > 0) {
        setPromos(data);

        // Calculate days remaining for first promo
        if (data[0].expires_at) {
          const expiryDate = new Date(data[0].expires_at);
          const today = new Date();
          const diffTime = expiryDate.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          setDaysRemaining(diffDays > 0 ? diffDays : null);
        }
      }
    };
    fetchPromos();
  }, []);

  // Rotate through promos every 5 seconds
  useEffect(() => {
    if (promos.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentPromoIndex(prev => (prev + 1) % promos.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [promos.length]);
  if (isDismissed || promos.length === 0) return null;
  const currentPromo = promos[currentPromoIndex];
  const discountText = currentPromo.type === 'percent' ? `${currentPromo.value}% OFF` : `$${currentPromo.value} OFF`;
  return <div className={cn("relative overflow-hidden bg-gradient-to-r from-primary via-primary/90 to-primary/80", className)}>
      {/* Animated background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,white_0%,transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_50%,white_0%,transparent_50%)]" />
      </div>
      
      <div className="container mx-auto px-4 py-3 relative">
        <div className="flex items-center justify-center gap-3">
          {/* Animated icon */}
          <div className="flex-shrink-0 animate-pulse">
            
          </div>
          
          {/* Promo text */}
          <div className="flex items-center gap-2 text-white text-center">
            <span className="font-bold text-sm md:text-base">New Year Special: Claim Our Membership And Get Your First Clean For Only $189</span>
          </div>
          
          {/* Sparkle decoration */}
          
          
          {/* Dismiss button */}
          <button onClick={() => setIsDismissed(true)} className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded-full transition-colors" aria-label="Dismiss banner">
            <RiCloseLine className="w-4 h-4 text-white/70 hover:text-white" />
          </button>
        </div>
        
        {/* Progress dots for multiple promos */}
        {promos.length > 1}
      </div>
    </div>;
}