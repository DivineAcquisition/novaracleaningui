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
      availability_slots: {
        Row: {
          created_at: string
          current_bookings: number
          end_time: string
          id: string
          is_available: boolean | null
          max_capacity: number
          service_date: string
          start_time: string
          time_slot: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_bookings?: number
          end_time: string
          id?: string
          is_available?: boolean | null
          max_capacity?: number
          service_date: string
          start_time: string
          time_slot: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_bookings?: number
          end_time?: string
          id?: string
          is_available?: boolean | null
          max_capacity?: number
          service_date?: string
          start_time?: string
          time_slot?: string
          updated_at?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          access_notes: string | null
          add_ons: string[] | null
          address: string
          after_photos: string[] | null
          arrival_window: string | null
          assigned_at: string | null
          base_price_cents: number
          bathrooms: number | null
          bedrooms: number | null
          before_photos: string[] | null
          booker_source: string | null
          booking_channel: string | null
          booking_number: number | null
          cancel_reason: string | null
          check_in_time: string | null
          check_out_time: string | null
          checkout_session_id: string | null
          city: string
          cleaner_hourly_rate_cents: number | null
          cleaner_id: string | null
          cleaner_payout_cents: number | null
          completed_at: string | null
          confirmation_email_sent: boolean | null
          confirmation_email_sent_at: string | null
          created_at: string | null
          customer_id: string | null
          deposit_cents: number
          dispatch_notes: string | null
          dwelling_type: string | null
          email: string
          estimated_duration_hours: number | null
          final_charge_cents: number | null
          first_name: string
          frequency: string | null
          full_payment_discount: number | null
          home_size_id: string
          id: string
          issues_flag: boolean | null
          issues_notes: string | null
          job_id: string | null
          last_name: string
          membership_plan: string | null
          payment_intent_id: string | null
          payment_method: string | null
          payment_option: string | null
          payout_status: string | null
          pets: string | null
          phone: string
          platform_fee_cents: number | null
          rating_submitted: boolean | null
          service_date: string
          service_type: string
          sqft: number | null
          state: string
          status: string | null
          stripe_invoice_id: string | null
          tax_cents: number | null
          team_notes: string | null
          time_slot: string
          tip_cents: number | null
          total_estimate_cents: number
          updated_at: string | null
          uses_credit: boolean | null
          zip_code: string
        }
        Insert: {
          access_notes?: string | null
          add_ons?: string[] | null
          address: string
          after_photos?: string[] | null
          arrival_window?: string | null
          assigned_at?: string | null
          base_price_cents: number
          bathrooms?: number | null
          bedrooms?: number | null
          before_photos?: string[] | null
          booker_source?: string | null
          booking_channel?: string | null
          booking_number?: number | null
          cancel_reason?: string | null
          check_in_time?: string | null
          check_out_time?: string | null
          checkout_session_id?: string | null
          city: string
          cleaner_hourly_rate_cents?: number | null
          cleaner_id?: string | null
          cleaner_payout_cents?: number | null
          completed_at?: string | null
          confirmation_email_sent?: boolean | null
          confirmation_email_sent_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          deposit_cents: number
          dispatch_notes?: string | null
          dwelling_type?: string | null
          email: string
          estimated_duration_hours?: number | null
          final_charge_cents?: number | null
          first_name: string
          frequency?: string | null
          full_payment_discount?: number | null
          home_size_id: string
          id?: string
          issues_flag?: boolean | null
          issues_notes?: string | null
          job_id?: string | null
          last_name: string
          membership_plan?: string | null
          payment_intent_id?: string | null
          payment_method?: string | null
          payment_option?: string | null
          payout_status?: string | null
          pets?: string | null
          phone: string
          platform_fee_cents?: number | null
          rating_submitted?: boolean | null
          service_date: string
          service_type: string
          sqft?: number | null
          state: string
          status?: string | null
          stripe_invoice_id?: string | null
          tax_cents?: number | null
          team_notes?: string | null
          time_slot: string
          tip_cents?: number | null
          total_estimate_cents: number
          updated_at?: string | null
          uses_credit?: boolean | null
          zip_code: string
        }
        Update: {
          access_notes?: string | null
          add_ons?: string[] | null
          address?: string
          after_photos?: string[] | null
          arrival_window?: string | null
          assigned_at?: string | null
          base_price_cents?: number
          bathrooms?: number | null
          bedrooms?: number | null
          before_photos?: string[] | null
          booker_source?: string | null
          booking_channel?: string | null
          booking_number?: number | null
          cancel_reason?: string | null
          check_in_time?: string | null
          check_out_time?: string | null
          checkout_session_id?: string | null
          city?: string
          cleaner_hourly_rate_cents?: number | null
          cleaner_id?: string | null
          cleaner_payout_cents?: number | null
          completed_at?: string | null
          confirmation_email_sent?: boolean | null
          confirmation_email_sent_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          deposit_cents?: number
          dispatch_notes?: string | null
          dwelling_type?: string | null
          email?: string
          estimated_duration_hours?: number | null
          final_charge_cents?: number | null
          first_name?: string
          frequency?: string | null
          full_payment_discount?: number | null
          home_size_id?: string
          id?: string
          issues_flag?: boolean | null
          issues_notes?: string | null
          job_id?: string | null
          last_name?: string
          membership_plan?: string | null
          payment_intent_id?: string | null
          payment_method?: string | null
          payment_option?: string | null
          payout_status?: string | null
          pets?: string | null
          phone?: string
          platform_fee_cents?: number | null
          rating_submitted?: boolean | null
          service_date?: string
          service_type?: string
          sqft?: number | null
          state?: string
          status?: string | null
          stripe_invoice_id?: string | null
          tax_cents?: number | null
          team_notes?: string | null
          time_slot?: string
          tip_cents?: number | null
          total_estimate_cents?: number
          updated_at?: string | null
          uses_credit?: boolean | null
          zip_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_cleaner_id_fkey"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaner_onboarding_pins: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          pin_code: string
          used_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          pin_code: string
          used_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          pin_code?: string
          used_at?: string | null
        }
        Relationships: []
      }
      cleaner_ratings: {
        Row: {
          booking_id: string
          cleaner_id: string
          created_at: string
          customer_email: string
          id: string
          rating: number
          review: string | null
        }
        Insert: {
          booking_id: string
          cleaner_id: string
          created_at?: string
          customer_email: string
          id?: string
          rating: number
          review?: string | null
        }
        Update: {
          booking_id?: string
          cleaner_id?: string
          created_at?: string
          customer_email?: string
          id?: string
          rating?: number
          review?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cleaner_ratings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cleaner_ratings_cleaner_id_fkey"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
        ]
      }
      cleaner_verification_codes: {
        Row: {
          code: string
          created_at: string | null
          email: string
          expires_at: string
          id: string
          used: boolean | null
        }
        Insert: {
          code: string
          created_at?: string | null
          email: string
          expires_at: string
          id?: string
          used?: boolean | null
        }
        Update: {
          code?: string
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          used?: boolean | null
        }
        Relationships: []
      }
      cleaners: {
        Row: {
          acceptance_rate: number | null
          activated_at: string | null
          approved: boolean
          available_for_bookings: boolean | null
          avatar_url: string | null
          average_rating: number | null
          completed_bookings: number | null
          created_at: string
          email: string
          first_name: string
          home_lat: number | null
          home_lng: number | null
          home_zip: string | null
          id: string
          invited_at: string | null
          jobs_assigned_last_7d: number | null
          last_name: string
          max_travel_miles: number | null
          max_weekly_bookings: number | null
          on_time_rate: number | null
          onboarding_complete: boolean | null
          pay_rate_hr: number
          payouts_enabled: boolean | null
          phone: string
          phone_verification_code: string | null
          phone_verification_sent_at: string | null
          phone_verified: boolean | null
          preferred_work_days: string[] | null
          service_zip_codes: string[] | null
          skillset: string[] | null
          sms_notifications_enabled: boolean | null
          sms_quiet_hours_end: string | null
          sms_quiet_hours_start: string | null
          state: string | null
          status: string
          status_today: string | null
          stripe_account_id: string | null
          total_bookings: number | null
          total_earnings_cents: number | null
          total_offers_accepted: number | null
          total_offers_received: number | null
          total_on_time_arrivals: number | null
          total_ratings: number | null
          updated_at: string
          user_id: string | null
          weighted_score: number | null
          workload_score: number | null
        }
        Insert: {
          acceptance_rate?: number | null
          activated_at?: string | null
          approved?: boolean
          available_for_bookings?: boolean | null
          avatar_url?: string | null
          average_rating?: number | null
          completed_bookings?: number | null
          created_at?: string
          email: string
          first_name: string
          home_lat?: number | null
          home_lng?: number | null
          home_zip?: string | null
          id?: string
          invited_at?: string | null
          jobs_assigned_last_7d?: number | null
          last_name: string
          max_travel_miles?: number | null
          max_weekly_bookings?: number | null
          on_time_rate?: number | null
          onboarding_complete?: boolean | null
          pay_rate_hr?: number
          payouts_enabled?: boolean | null
          phone: string
          phone_verification_code?: string | null
          phone_verification_sent_at?: string | null
          phone_verified?: boolean | null
          preferred_work_days?: string[] | null
          service_zip_codes?: string[] | null
          skillset?: string[] | null
          sms_notifications_enabled?: boolean | null
          sms_quiet_hours_end?: string | null
          sms_quiet_hours_start?: string | null
          state?: string | null
          status?: string
          status_today?: string | null
          stripe_account_id?: string | null
          total_bookings?: number | null
          total_earnings_cents?: number | null
          total_offers_accepted?: number | null
          total_offers_received?: number | null
          total_on_time_arrivals?: number | null
          total_ratings?: number | null
          updated_at?: string
          user_id?: string | null
          weighted_score?: number | null
          workload_score?: number | null
        }
        Update: {
          acceptance_rate?: number | null
          activated_at?: string | null
          approved?: boolean
          available_for_bookings?: boolean | null
          avatar_url?: string | null
          average_rating?: number | null
          completed_bookings?: number | null
          created_at?: string
          email?: string
          first_name?: string
          home_lat?: number | null
          home_lng?: number | null
          home_zip?: string | null
          id?: string
          invited_at?: string | null
          jobs_assigned_last_7d?: number | null
          last_name?: string
          max_travel_miles?: number | null
          max_weekly_bookings?: number | null
          on_time_rate?: number | null
          onboarding_complete?: boolean | null
          pay_rate_hr?: number
          payouts_enabled?: boolean | null
          phone?: string
          phone_verification_code?: string | null
          phone_verification_sent_at?: string | null
          phone_verified?: boolean | null
          preferred_work_days?: string[] | null
          service_zip_codes?: string[] | null
          skillset?: string[] | null
          sms_notifications_enabled?: boolean | null
          sms_quiet_hours_end?: string | null
          sms_quiet_hours_start?: string | null
          state?: string | null
          status?: string
          status_today?: string | null
          stripe_account_id?: string | null
          total_bookings?: number | null
          total_earnings_cents?: number | null
          total_offers_accepted?: number | null
          total_offers_received?: number | null
          total_on_time_arrivals?: number | null
          total_ratings?: number | null
          updated_at?: string
          user_id?: string | null
          weighted_score?: number | null
          workload_score?: number | null
        }
        Relationships: []
      }
      custom_quotes: {
        Row: {
          address: string
          created_at: string | null
          email: string
          full_name: string
          id: string
          notes: string | null
          phone: string
          sqft: number
          status: string | null
        }
        Insert: {
          address: string
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          notes?: string | null
          phone: string
          sqft: number
          status?: string | null
        }
        Update: {
          address?: string
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string
          sqft?: number
          status?: string | null
        }
        Relationships: []
      }
      customers: {
        Row: {
          address: string | null
          analytics_source: string | null
          city: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          lat: number | null
          lng: number | null
          phone: string | null
          referral_code: string | null
          state: string | null
          updated_at: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          analytics_source?: string | null
          city?: string | null
          created_at?: string
          email: string
          first_name: string
          id?: string
          last_name: string
          lat?: number | null
          lng?: number | null
          phone?: string | null
          referral_code?: string | null
          state?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          analytics_source?: string | null
          city?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          lat?: number | null
          lng?: number | null
          phone?: string | null
          referral_code?: string | null
          state?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      dispatch_alerts: {
        Row: {
          created_at: string
          id: string
          job_id: string
          reason: string
          resolved: boolean | null
          resolved_at: string | null
          severity: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          reason: string
          resolved?: boolean | null
          resolved_at?: string | null
          severity?: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          reason?: string
          resolved?: boolean | null
          resolved_at?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_alerts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      email_retry_queue: {
        Row: {
          booking_id: string
          created_at: string | null
          email_data: Json
          email_type: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          max_retries: number | null
          next_retry_at: string | null
          recipient_email: string
          retry_count: number | null
          sent_at: string | null
          status: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string | null
          email_data: Json
          email_type: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          max_retries?: number | null
          next_retry_at?: string | null
          recipient_email: string
          retry_count?: number | null
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string | null
          email_data?: Json
          email_type?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          max_retries?: number | null
          next_retry_at?: string | null
          recipient_email?: string
          retry_count?: number | null
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_retry_queue_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      job_assignments: {
        Row: {
          assigned_at: string
          cleaner_id: string
          created_at: string
          distance_miles: number | null
          estimated_pay_cents: number | null
          id: string
          job_id: string
          pay_rate_hr: number | null
          reminder_count: number | null
          reminder_sent_at: string | null
          responded_at: string | null
          role: string
          status: string
        }
        Insert: {
          assigned_at?: string
          cleaner_id: string
          created_at?: string
          distance_miles?: number | null
          estimated_pay_cents?: number | null
          id?: string
          job_id: string
          pay_rate_hr?: number | null
          reminder_count?: number | null
          reminder_sent_at?: string | null
          responded_at?: string | null
          role?: string
          status?: string
        }
        Update: {
          assigned_at?: string
          cleaner_id?: string
          created_at?: string
          distance_miles?: number | null
          estimated_pay_cents?: number | null
          id?: string
          job_id?: string
          pay_rate_hr?: number | null
          reminder_count?: number | null
          reminder_sent_at?: string | null
          responded_at?: string | null
          role?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_assignments_cleaner_id_fkey"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          actual_duration_hours: number | null
          address: string
          analytics_source: string | null
          bathrooms: number | null
          bedrooms: number | null
          check_in_time: string | null
          check_out_time: string | null
          city: string
          created_at: string
          customer_id: string | null
          dispatch_alert_reason: string | null
          duration_est_hours: number
          id: string
          lat: number | null
          lng: number | null
          manual_intervention_required: boolean | null
          min_cleaners_required: number
          notes: string | null
          service_type: string
          sq_ft: number | null
          start_datetime: string
          state: string
          status: string
          updated_at: string
          zip: string
        }
        Insert: {
          actual_duration_hours?: number | null
          address: string
          analytics_source?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          check_in_time?: string | null
          check_out_time?: string | null
          city: string
          created_at?: string
          customer_id?: string | null
          dispatch_alert_reason?: string | null
          duration_est_hours?: number
          id?: string
          lat?: number | null
          lng?: number | null
          manual_intervention_required?: boolean | null
          min_cleaners_required?: number
          notes?: string | null
          service_type?: string
          sq_ft?: number | null
          start_datetime: string
          state: string
          status?: string
          updated_at?: string
          zip: string
        }
        Update: {
          actual_duration_hours?: number | null
          address?: string
          analytics_source?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          check_in_time?: string | null
          check_out_time?: string | null
          city?: string
          created_at?: string
          customer_id?: string | null
          dispatch_alert_reason?: string | null
          duration_est_hours?: number
          id?: string
          lat?: number | null
          lng?: number | null
          manual_intervention_required?: boolean | null
          min_cleaners_required?: number
          notes?: string | null
          service_type?: string
          sq_ft?: number | null
          start_datetime?: string
          state?: string
          status?: string
          updated_at?: string
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_credits: {
        Row: {
          created_at: string | null
          credit_available_date: string | null
          credits_per_month: number
          credits_remaining: number
          credits_used: number | null
          current_period_end: string
          current_period_start: string
          customer_id: string
          email: string
          id: string
          membership_plan: string
          subscription_id: string
        }
        Insert: {
          created_at?: string | null
          credit_available_date?: string | null
          credits_per_month: number
          credits_remaining: number
          credits_used?: number | null
          current_period_end: string
          current_period_start: string
          customer_id: string
          email: string
          id?: string
          membership_plan: string
          subscription_id: string
        }
        Update: {
          created_at?: string | null
          credit_available_date?: string | null
          credits_per_month?: number
          credits_remaining?: number
          credits_used?: number | null
          current_period_end?: string
          current_period_start?: string
          customer_id?: string
          email?: string
          id?: string
          membership_plan?: string
          subscription_id?: string
        }
        Relationships: []
      }
      payouts: {
        Row: {
          booking_id: string
          cleaner_id: string
          cleaner_payout_cents: number
          created_at: string
          failed_reason: string | null
          id: string
          notes: string | null
          platform_fee_cents: number
          processed_at: string | null
          retry_count: number | null
          status: string
          stripe_account_id: string
          stripe_transfer_id: string | null
          total_booking_amount_cents: number
        }
        Insert: {
          booking_id: string
          cleaner_id: string
          cleaner_payout_cents: number
          created_at?: string
          failed_reason?: string | null
          id?: string
          notes?: string | null
          platform_fee_cents: number
          processed_at?: string | null
          retry_count?: number | null
          status?: string
          stripe_account_id: string
          stripe_transfer_id?: string | null
          total_booking_amount_cents: number
        }
        Update: {
          booking_id?: string
          cleaner_id?: string
          cleaner_payout_cents?: number
          created_at?: string
          failed_reason?: string | null
          id?: string
          notes?: string | null
          platform_fee_cents?: number
          processed_at?: string | null
          retry_count?: number | null
          status?: string
          stripe_account_id?: string
          stripe_transfer_id?: string | null
          total_booking_amount_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "payouts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_cleaner_id_fkey"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
        ]
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
          applies_to: string | null
          code: string
          created_at: string
          expires_at: string | null
          id: string
          max_total_uses: number | null
          max_uses_per_customer: number | null
          min_profit_margin_percent: number | null
          total_uses: number | null
          type: Database["public"]["Enums"]["promo_type"]
          value: number
        }
        Insert: {
          active?: boolean
          applies_to?: string | null
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          max_total_uses?: number | null
          max_uses_per_customer?: number | null
          min_profit_margin_percent?: number | null
          total_uses?: number | null
          type: Database["public"]["Enums"]["promo_type"]
          value: number
        }
        Update: {
          active?: boolean
          applies_to?: string | null
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          max_total_uses?: number | null
          max_uses_per_customer?: number | null
          min_profit_margin_percent?: number | null
          total_uses?: number | null
          type?: Database["public"]["Enums"]["promo_type"]
          value?: number
        }
        Relationships: []
      }
      referrals: {
        Row: {
          booking_id: string | null
          code: string
          created_at: string
          credit_cents: number | null
          customer_id: string
          id: string
          redeemed_at: string | null
          referred_booking_id: string | null
          referred_customer_id: string | null
          referred_email: string | null
          referrer_email: string | null
          status: Database["public"]["Enums"]["referral_status"]
          used_at: string | null
        }
        Insert: {
          booking_id?: string | null
          code: string
          created_at?: string
          credit_cents?: number | null
          customer_id: string
          id?: string
          redeemed_at?: string | null
          referred_booking_id?: string | null
          referred_customer_id?: string | null
          referred_email?: string | null
          referrer_email?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
          used_at?: string | null
        }
        Update: {
          booking_id?: string | null
          code?: string
          created_at?: string
          credit_cents?: number | null
          customer_id?: string
          id?: string
          redeemed_at?: string | null
          referred_booking_id?: string | null
          referred_customer_id?: string | null
          referred_email?: string | null
          referrer_email?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_booking_id_fkey"
            columns: ["referred_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
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
      reviews: {
        Row: {
          cleaner_id: string | null
          comment: string | null
          created_at: string
          id: string
          job_id: string
          rating: number
        }
        Insert: {
          cleaner_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          job_id: string
          rating: number
        }
        Update: {
          cleaner_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          job_id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "reviews_cleaner_id_fkey"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "cleaners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      service_coverage_zones: {
        Row: {
          city: string
          county: string | null
          created_at: string
          id: string
          is_active: boolean
          pricing_multiplier: number | null
          state: string
          tier: string
          tier_label: string
          updated_at: string
          zip_code: string
        }
        Insert: {
          city: string
          county?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          pricing_multiplier?: number | null
          state?: string
          tier: string
          tier_label: string
          updated_at?: string
          zip_code: string
        }
        Update: {
          city?: string
          county?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          pricing_multiplier?: number | null
          state?: string
          tier?: string
          tier_label?: string
          updated_at?: string
          zip_code?: string
        }
        Relationships: []
      }
      sms_consent_logs: {
        Row: {
          consent_given: boolean | null
          created_at: string | null
          email: string | null
          first_name: string
          id: string
          ip_address: string | null
          last_name: string
          phone: string
          revoked_at: string | null
          user_agent: string | null
        }
        Insert: {
          consent_given?: boolean | null
          created_at?: string | null
          email?: string | null
          first_name: string
          id?: string
          ip_address?: string | null
          last_name: string
          phone: string
          revoked_at?: string | null
          user_agent?: string | null
        }
        Update: {
          consent_given?: boolean | null
          created_at?: string | null
          email?: string | null
          first_name?: string
          id?: string
          ip_address?: string | null
          last_name?: string
          phone?: string
          revoked_at?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      sms_logs: {
        Row: {
          cost: number | null
          created_at: string
          error_message: string | null
          id: string
          job_assignment_id: string | null
          message: string
          provider_message_id: string | null
          status: string
          to_phone: string
          type: string
        }
        Insert: {
          cost?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_assignment_id?: string | null
          message: string
          provider_message_id?: string | null
          status?: string
          to_phone: string
          type: string
        }
        Update: {
          cost?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_assignment_id?: string | null
          message?: string
          provider_message_id?: string | null
          status?: string
          to_phone?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_logs_job_assignment_id_fkey"
            columns: ["job_assignment_id"]
            isOneToOne: false
            referencedRelation: "job_assignments"
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
      webhook_failures: {
        Row: {
          booking_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          payload: Json
          resolved: boolean | null
          retry_count: number | null
          webhook_url: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          payload: Json
          resolved?: boolean | null
          retry_count?: number | null
          webhook_url: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          payload?: Json
          resolved?: boolean | null
          retry_count?: number | null
          webhook_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_failures_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
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
      release_time_slot: {
        Args: { _date: string; _start_time: string }
        Returns: undefined
      }
      reserve_availability: {
        Args: { _date: string; _time_window: string }
        Returns: boolean
      }
      reserve_time_slot: {
        Args: { _date: string; _end_time: string; _start_time: string }
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
