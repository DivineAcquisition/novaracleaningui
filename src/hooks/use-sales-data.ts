import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CustomerSearchResult {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: "customer" | "booking" | "abandoned_cart";
  badge: string;
  badgeColor: string;
  bookingCount?: number;
  lastDate?: string;
  serviceType?: string;
}

export function useCustomerSearch(query: string) {
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    if (query.length < 2) { setDebouncedQuery(""); return; }
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  return useQuery({
    queryKey: ["customer-search", debouncedQuery],
    queryFn: async (): Promise<CustomerSearchResult[]> => {
      const q = debouncedQuery.trim();
      if (!q || q.length < 2) return [];
      const pattern = `%${q}%`;

      const [customersRes, bookingsRes, cartsRes] = await Promise.all([
        supabase.from("customers").select("first_name, last_name, email, phone")
          .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
          .limit(10),
        supabase.from("bookings").select("first_name, last_name, email, phone, service_date, service_type, status")
          .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("abandoned_carts").select("first_name, last_name, email, phone")
          .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`)
          .limit(10),
      ]);

      const seen = new Map<string, CustomerSearchResult>();

      // Bookings first (highest signal)
      for (const b of bookingsRes.data || []) {
        if (!b.email) continue;
        const key = b.email.toLowerCase();
        const existing = seen.get(key);
        if (existing) {
          existing.bookingCount = (existing.bookingCount || 0) + 1;
        } else {
          seen.set(key, {
            firstName: b.first_name, lastName: b.last_name,
            email: b.email, phone: b.phone || "",
            source: "booking", badge: "Booked Before",
            badgeColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
            bookingCount: 1, lastDate: b.service_date, serviceType: b.service_type,
          });
        }
      }

      // Customers
      for (const c of customersRes.data || []) {
        const key = c.email.toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, {
            firstName: c.first_name, lastName: c.last_name,
            email: c.email, phone: c.phone || "",
            source: "customer", badge: "Customer Record",
            badgeColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
          });
        }
      }

      // Abandoned carts
      for (const a of cartsRes.data || []) {
        const key = a.email.toLowerCase();
        if (!seen.has(key)) {
          seen.set(key, {
            firstName: a.first_name || "", lastName: a.last_name || "",
            email: a.email, phone: a.phone || "",
            source: "abandoned_cart", badge: "Abandoned Cart",
            badgeColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
          });
        }
      }

      return Array.from(seen.values());
    },
    enabled: debouncedQuery.length >= 2,
  });
}

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
