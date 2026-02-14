import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useServiceCoverage(zipCode: string) {
  return useQuery({
    queryKey: ["service-coverage", zipCode],
    queryFn: async () => {
      if (!zipCode || zipCode.length < 5) return null;
      const { data, error } = await supabase
        .from("service_coverage_zones")
        .select("*")
        .eq("zip_code", zipCode)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: zipCode.length >= 5,
  });
}

export function usePricingConfig() {
  return useQuery({
    queryKey: ["pricing-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pricing_config")
        .select("*")
        .order("tier");
      if (error) throw error;
      return data;
    },
  });
}

export function useSalesScripts(category?: string, channel?: string) {
  return useQuery({
    queryKey: ["sales-scripts", category, channel],
    queryFn: async () => {
      let query = supabase
        .from("sales_scripts")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (category) query = query.eq("category", category);
      const { data, error } = await query;
      if (error) throw error;
      // Filter by channel if specified
      if (channel && data) {
        return data.filter(
          (s) => s.channel === "all" || s.channel === channel || !s.channel
        );
      }
      return data;
    },
  });
}

export function useCustomerLookup(email: string) {
  return useQuery({
    queryKey: ["customer-lookup", email],
    queryFn: async () => {
      if (!email) return null;
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("email", email)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!email && email.includes("@"),
  });
}

export function useCustomerBookings(email: string) {
  return useQuery({
    queryKey: ["customer-bookings", email],
    queryFn: async () => {
      if (!email) return [];
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("email", email)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    enabled: !!email && email.includes("@"),
  });
}
