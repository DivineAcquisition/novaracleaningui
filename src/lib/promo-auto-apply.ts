/**
 * Automatic Promo Code Application Utility
 * Finds and applies the best eligible promo code for a customer
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface EligiblePromo {
  code: string;
  value: number;
  type: 'percent' | 'amount';
  discount: number;
  description: string;
}

/**
 * Find the best eligible promo code for a customer
 */
export async function findBestPromoCode(
  supabase: SupabaseClient,
  customerEmail: string,
  isNewCustomer: boolean,
  subtotal: number
): Promise<EligiblePromo | null> {
  try {
    // Fetch all active promo codes
    const { data: promoCodes, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('active', true)
      .or('expires_at.is.null,expires_at.gte.' + new Date().toISOString())
      .order('value', { ascending: false });

    if (error || !promoCodes || promoCodes.length === 0) {
      return null;
    }

    // Check customer's promo usage history
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, team_notes')
      .eq('email', customerEmail);

    const eligiblePromos: Array<EligiblePromo> = [];

    for (const promo of promoCodes) {
      // Check customer type eligibility
      if (promo.applies_to === 'new_customers' && !isNewCustomer) continue;
      if (promo.applies_to === 'returning_customers' && isNewCustomer) continue;

      // Check total usage limit
      if (promo.max_total_uses && promo.total_uses >= promo.max_total_uses) continue;

      // Check per-customer usage limit
      if (promo.max_uses_per_customer && bookings) {
        const usageCount = bookings.filter(b => 
          b.team_notes?.includes(`PROMO:${promo.code}`)
        ).length;
        
        if (usageCount >= promo.max_uses_per_customer) continue;
      }

      // Calculate discount
      let discount = 0;
      if (promo.type === 'percent') {
        discount = Math.round((subtotal * promo.value) / 100 * 100) / 100;
      } else {
        discount = promo.value;
      }

      // Create description based on promo details
      let description = '';
      if (promo.code === 'HOLIDAY25') {
        description = '🎄 25% Holiday Discount - New Customers Only';
      } else if (promo.code === 'JOLLY20') {
        description = '🎁 20% Holiday Savings - Returning Customers';
      } else if (promo.code === 'NEWYEAR15') {
        description = '✨ 15% New Year Special - All Customers';
      } else {
        description = `${promo.value}% off your booking`;
      }

      eligiblePromos.push({
        code: promo.code,
        value: promo.value,
        type: promo.type,
        discount,
        description,
      });
    }

    // Return the promo with the highest discount
    if (eligiblePromos.length === 0) return null;

    return eligiblePromos.reduce((best, current) => 
      current.discount > best.discount ? current : best
    );
  } catch (error) {
    console.error('Error finding best promo code:', error);
    return null;
  }
}

/**
 * Format promo savings message
 */
export function formatPromoSavings(promo: EligiblePromo): string {
  return `🎉 Auto-applied: ${promo.code} - Save $${promo.discount.toFixed(2)}!`;
}

/**
 * Get promo code recommendation message
 */
export function getPromoRecommendation(isNewCustomer: boolean): string {
  if (isNewCustomer) {
    return "💡 You're eligible for our biggest holiday discount! HOLIDAY25 will be automatically applied.";
  }
  return "💡 We've found the best available discount for you and applied it automatically!";
}
