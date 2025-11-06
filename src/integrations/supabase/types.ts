export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          bathrooms: number | null
          bedrooms: number | null
          city: string
          created_at: string
          customer_id: string
          id: string
          notes: string | null
          pets: boolean | null
          sqft_tier: string
          state: string
          street: string
          unit: string | null
          zip: string
        }
        Insert: {
          bathrooms?: number | null
          bedrooms?: number | null
          city: string
          created_at?: string
          customer_id: string
          id?: string
          notes?: string | null
          pets?: boolean | null
          sqft_tier: string
          state: string
          street: string
          unit?: string | null
          zip: string
        }
        Update: {
          bathrooms?: number | null
          bedrooms?: number | null
          city?: string
          created_at?: string
          customer_id?: string
          id?: string
          notes?: string | null
          pets?: boolean | null
          sqft_tier?: string
          state?: string
          street?: string
          unit?: string | null
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      availability: {
        Row: {
          capacity: number
          created_at: string
          id: string
          service_date: string
          time_window: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          id?: string
          service_date: string
          time_window: string
        }
        Update: {
          capacity?: number
          created_at?: string
          id?: string
          service_date?: string
          time_window?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          add_ons: Json | null
          address_id: string
          arrival_window: string
          created_at: string
          customer_id: string
          frequency: Database["public"]["Enums"]["booking_frequency"] | null
          id: string
          per_clean_cents: number
          promo_code: string | null
          referral_code: string | null
          service_date: string
          sqft_tier: string
          status: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id: string | null
          stripe_subscription_id: string | null
          total_amount_cents: number
          type: Database["public"]["Enums"]["booking_type"]
          updated_at: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          add_ons?: Json | null
          address_id: string
          arrival_window: string
          created_at?: string
          customer_id: string
          frequency?: Database["public"]["Enums"]["booking_frequency"] | null
          id?: string
          per_clean_cents: number
          promo_code?: string | null
          referral_code?: string | null
          service_date: string
          sqft_tier: string
          status?: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          total_amount_cents: number
          type: Database["public"]["Enums"]["booking_type"]
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          add_ons?: Json | null
          address_id?: string
          arrival_window?: string
          created_at?: string
          customer_id?: string
          frequency?: Database["public"]["Enums"]["booking_frequency"] | null
          id?: string
          per_clean_cents?: number
          promo_code?: string | null
          referral_code?: string | null
          service_date?: string
          sqft_tier?: string
          status?: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          total_amount_cents?: number
          type?: Database["public"]["Enums"]["booking_type"]
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          phone: string | null
          referral_code: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          first_name: string
          id?: string
          last_name: string
          phone?: string | null
          referral_code?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          phone?: string | null
          referral_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pricing_config: {
        Row: {
          frequency: string
          id: string
          price_cents: number
          tier: string
          updated_at: string
        }
        Insert: {
          frequency: string
          id?: string
          price_cents: number
          tier: string
          updated_at?: string
        }
        Update: {
          frequency?: string
          id?: string
          price_cents?: number
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          expires_at: string | null
          id: string
          type: Database["public"]["Enums"]["promo_type"]
          value: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          type: Database["public"]["Enums"]["promo_type"]
          value: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          type?: Database["public"]["Enums"]["promo_type"]
          value?: number
        }
        Relationships: []
      }
      referrals: {
        Row: {
          code: string
          created_at: string
          credit_cents: number | null
          customer_id: string
          id: string
          redeemed_at: string | null
          referred_customer_id: string | null
          status: Database["public"]["Enums"]["referral_status"]
        }
        Insert: {
          code: string
          created_at?: string
          credit_cents?: number | null
          customer_id: string
          id?: string
          redeemed_at?: string | null
          referred_customer_id?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
        }
        Update: {
          code?: string
          created_at?: string
          credit_cents?: number | null
          customer_id?: string
          id?: string
          redeemed_at?: string | null
          referred_customer_id?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
        }
        Relationships: [
          {
            foreignKeyName: "referrals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_customer_id_fkey"
            columns: ["referred_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      reserve_availability: {
        Args: { _date: string; _time_window: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "customer"
      booking_frequency: "monthly" | "biweekly" | "weekly"
      booking_status: "pending" | "confirmed" | "completed" | "cancelled"
      booking_type: "one_time" | "recurring"
      promo_type: "amount" | "percent"
      referral_status: "pending" | "redeemed" | "expired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "customer"],
      booking_frequency: ["monthly", "biweekly", "weekly"],
      booking_status: ["pending", "confirmed", "completed", "cancelled"],
      booking_type: ["one_time", "recurring"],
      promo_type: ["amount", "percent"],
      referral_status: ["pending", "redeemed", "expired"],
    },
  },
} as const
