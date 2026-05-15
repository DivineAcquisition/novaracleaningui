"use client";

import {
  RiAlertLine,
  RiArrowGoBackLine,
  RiBarChartBoxLine,
  RiCheckboxCircleLine,
  RiGroupLine,
  RiLoader4Line,
  RiLockLine,
  RiMoneyDollarCircleLine,
  RiPencilLine,
  RiPriceTag3Line,
  RiRefreshLine,
  RiSaveLine,
  RiSearchLine,
  RiTimeLine,
  RiWebhookLine
} from "@remixicon/react";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FIRST_CLEAN_PROMO } from "@/config/brand-config";
import { LiveQuotePanel } from "@/components/sales/LiveQuotePanel";
import { SalesAssistPanel } from "@/components/sales/SalesAssistPanel";
import { FollowUpScheduler } from "@/components/sales/FollowUpScheduler";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toast as toastHook } from "@/hooks/use-toast";
import { SEO } from "@/components/SEO";

import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING, ADD_ONS, calculatePrice, DEPOSIT_PERCENT, applyPromoCode } from "@/lib/pricing-system";
import { IntakePricingSidebar } from "@/components/admin/IntakePricingSidebar";
import { calculateServiceDuration } from "@/lib/time-slots";
import { CleanerMultiSelect, SelectedCleaner } from "@/components/admin/CleanerMultiSelect";
import { CustomerRecognitionCard, CustomerStatus } from "@/components/admin/CustomerRecognitionCard";
import { calculateDistance } from "@/lib/distance-calculator";
import { AddressAutocomplete } from "@/components/admin/AddressAutocomplete";
import { useCustomerSearch, CustomerSearchResult } from "@/hooks/use-sales-data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { Badge } from "@/components/ui/badge";
import { calculateProfit } from "@/lib/profit-calculator";

const ACCESS_PIN = "1234";
const AUTOSAVE_KEY = "sales_tool_autosave";
const AUTOSAVE_INTERVAL = 30000;

const BRAND_GREEN = "hsl(142, 76%, 36%)";

const LEAD_SOURCES = ["Google Ads", "Facebook", "Instagram DM", "Referral", "Website", "Cold Outreach", "Other"];
const CONTACT_CHANNELS = ["Phone Call", "Text/SMS", "Instagram DM", "Facebook DM", "Email"];

interface Cleaner {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  home_lat?: number;
  home_lng?: number;
  pay_rate_hr: number;
  max_travel_miles?: number;
  distance?: number;
}

export default function SalesTool() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ─── PIN Authentication ───
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinCode, setPinCode] = useState(["", "", "", ""]);
  const [pinError, setPinError] = useState(false);

  useEffect(() => {
    const hasAccess = sessionStorage.getItem("sales_access");
    if (hasAccess === "true") setIsAuthenticated(true);
  }, []);

  const handlePinChange = (index: number, value: string) => {
    if (value.length > 1) return;
    if (value && !/^\d$/.test(value)) return;
    const newPin = [...pinCode];
    newPin[index] = value;
    setPinCode(newPin);
    setPinError(false);
    if (value && index < 3) {
      document.getElementById(`sales-pin-${index + 1}`)?.focus();
    }
  };

  const handlePinSubmit = () => {
    if (pinCode.join("") === ACCESS_PIN) {
      sessionStorage.setItem("sales_access", "true");
      setIsAuthenticated(true);
    } else {
      setPinError(true);
      setPinCode(["", "", "", ""]);
      document.getElementById("sales-pin-0")?.focus();
    }
  };

  // ─── Customer Search ───
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: searchResults, isLoading: searchLoading } = useCustomerSearch(searchQuery);

  const handleSelectSearchResult = (result: CustomerSearchResult) => {
    setFirstName(result.firstName);
    setLastName(result.lastName);
    setEmail(result.email);
    setPhone(result.phone || "");
    setSearchOpen(false);
    setSearchQuery("");
    toast.success(`Loaded: ${result.firstName} ${result.lastName}`);
  };

  // ─── Unified Form State ───
  const [saving, setSaving] = useState(false);
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [loading, setLoading] = useState(false);

  // Customer Info
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [customerSource, setCustomerSource] = useState("New Lead");
  const [sdrRepName, setSdrRepName] = useState("");
  const [leadSource, setLeadSource] = useState("Website");
  const [channel, setChannel] = useState("Phone Call");
  const [activeChannel, setActiveChannel] = useState("Phone Call");
  const [notes, setNotes] = useState("");

  // Service Address
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("MD");
  const [zipCode, setZipCode] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [dwellingType, setDwellingType] = useState("");
  const [pets, setPets] = useState("None");

  // Service Details
  const [homeSizeId, setHomeSizeId] = useState("");
  const [serviceType, setServiceType] = useState("standard");
  const [addOns, setAddOns] = useState<string[]>([]);
  const [frequency, setFrequency] = useState("One-Time");

  // Scheduling
  const [serviceDate, setServiceDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [estimatedDuration, setEstimatedDuration] = useState("");
  const [arrivalWindow, setArrivalWindow] = useState("");

  // Booking Config
  const [bookingChannel, setBookingChannel] = useState("Phone");
  const [paymentStatus, setPaymentStatus] = useState("Deposit Paid");
  const [paymentMethod, setPaymentMethod] = useState("Card");
  const [membershipPlan, setMembershipPlan] = useState("none");
  const [customDiscount, setCustomDiscount] = useState(0);
  const [promoCode, setPromoCode] = useState("");
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoMessage, setPromoMessage] = useState("");
  const [promoValid, setPromoValid] = useState(false);
  const [applyingPromo, setApplyingPromo] = useState(false);
  const [applyFirstCleanPromo, setApplyFirstCleanPromo] = useState(false);

  // Notes
  const [accessNotes, setAccessNotes] = useState("");
  const [teamNotes, setTeamNotes] = useState("");
  const [dispatchNotes, setDispatchNotes] = useState("");

  // Cleaner Assignment
  const [numCleaners, setNumCleaners] = useState(2);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [selectedCleaners, setSelectedCleaners] = useState<SelectedCleaner[]>([]);
  const [customerLocation, setCustomerLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [customerStatus, setCustomerStatus] = useState<CustomerStatus | null>(null);
  const [checkingCustomer, setCheckingCustomer] = useState(false);

  // Auto-calculate number of cleaners from home size
  useEffect(() => {
    if (homeSizeId) {
      const hs = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
      if (hs) {
        const autoNum = (hs.maxSqft || hs.minSqft) > 2500 ? 3 : 2;
        setNumCleaners(autoNum);
      }
    }
  }, [homeSizeId]);

  // Load lead from URL param
  const leadIdParam = searchParams.get("leadId");
  useEffect(() => {
    if (!leadIdParam) return;
    const loadLead = async () => {
      const { data, error } = await supabase.from("leads").select("*").eq("id", leadIdParam).single();
      if (error || !data) { toast.error("Lead not found"); return; }
      const l = data as any;
      setFirstName(l.first_name || "");
      setLastName(l.last_name || "");
      setPhone(l.phone || "");
      setEmail(l.email || "");
      setLeadSource(l.source || "Website");
      setChannel(l.channel || "Phone Call");
      setActiveChannel(l.active_channel || "Phone Call");
      setNotes(l.notes || "");
      setServiceType(l.service_type || "standard");
      setBedrooms(l.bedrooms ? String(l.bedrooms) : "");
      setBathrooms(l.bathrooms ? String(l.bathrooms) : "");
      setZipCode(l.zip_code || "");
      setFrequency(l.frequency || "One-Time");
      setServiceDate(l.preferred_date || "");
      setSavedLeadId(l.id);
      setIsEditing(true);
    };
    loadLead();
  }, [leadIdParam]);

  // Autosave check
  useEffect(() => {
    if (leadIdParam || !isAuthenticated) return;
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) {
      try {
        const { timestamp } = JSON.parse(saved);
        if ((Date.now() - timestamp) / 3600000 < 24) setShowRestorePrompt(true);
        else localStorage.removeItem(AUTOSAVE_KEY);
      } catch { localStorage.removeItem(AUTOSAVE_KEY); }
    }
  }, [leadIdParam, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (savedLeadId && !isEditing) return;
    const interval = setInterval(() => {
      if (firstName || email || zipCode) {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
          firstName, lastName, email, phone, leadSource, channel, activeChannel, notes,
          street, city, state, zipCode, bedrooms, bathrooms, homeSizeId, serviceType,
          addOns, frequency, serviceDate, sdrRepName,
          timestamp: Date.now(),
        }));
      }
    }, AUTOSAVE_INTERVAL);
    return () => clearInterval(interval);
  }, [firstName, lastName, email, phone, leadSource, channel, activeChannel, notes,
    street, city, state, zipCode, bedrooms, bathrooms, homeSizeId, serviceType,
    addOns, frequency, serviceDate, sdrRepName, savedLeadId, isEditing, isAuthenticated]);

  const handleRestore = () => {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) {
      try {
        const d = JSON.parse(saved);
        if (d.firstName) setFirstName(d.firstName);
        if (d.lastName) setLastName(d.lastName);
        if (d.email) setEmail(d.email);
        if (d.phone) setPhone(d.phone);
        if (d.leadSource) setLeadSource(d.leadSource);
        if (d.channel) setChannel(d.channel);
        if (d.activeChannel) setActiveChannel(d.activeChannel);
        if (d.notes) setNotes(d.notes);
        if (d.street) setStreet(d.street);
        if (d.city) setCity(d.city);
        if (d.state) setState(d.state);
        if (d.zipCode) setZipCode(d.zipCode);
        if (d.bedrooms) setBedrooms(d.bedrooms);
        if (d.bathrooms) setBathrooms(d.bathrooms);
        if (d.homeSizeId) setHomeSizeId(d.homeSizeId);
        if (d.serviceType) setServiceType(d.serviceType);
        if (d.addOns) setAddOns(d.addOns);
        if (d.frequency) setFrequency(d.frequency);
        if (d.serviceDate) setServiceDate(d.serviceDate);
        if (d.sdrRepName) setSdrRepName(d.sdrRepName);
        toast.success("Form data restored");
      } catch { toast.error("Failed to restore data"); }
    }
    setShowRestorePrompt(false);
  };

  const handleDiscardRestore = () => {
    localStorage.removeItem(AUTOSAVE_KEY);
    setShowRestorePrompt(false);
  };

  const resetForm = () => {
    setFirstName(""); setLastName(""); setEmail(""); setPhone("");
    setCustomerSource("New Lead"); setSdrRepName(""); setLeadSource("Website");
    setChannel("Phone Call"); setActiveChannel("Phone Call"); setNotes("");
    setStreet(""); setCity(""); setState("MD"); setZipCode("");
    setBedrooms(""); setBathrooms(""); setDwellingType(""); setPets("None");
    setHomeSizeId(""); setServiceType("standard"); setAddOns([]); setFrequency("One-Time");
    setServiceDate(""); setTimeSlot(""); setEstimatedDuration(""); setArrivalWindow("");
    setBookingChannel("Phone"); setPaymentStatus("Deposit Paid"); setPaymentMethod("Card");
    setMembershipPlan("none"); setCustomDiscount(0);
    setPromoCode(""); setPromoDiscount(0); setPromoMessage(""); setPromoValid(false);
    setAccessNotes(""); setTeamNotes(""); setDispatchNotes("");
    setSelectedCleaners([]); setCustomerStatus(null); setCustomerLocation(null);
    setNumCleaners(2); setSavedLeadId(null); setIsEditing(false);
    setApplyFirstCleanPromo(false);
    router.replace("/admin/sales");
    localStorage.removeItem(AUTOSAVE_KEY);
    localStorage.removeItem("admin_intake_autosave");
  };

  // Fetch cleaners
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchCleaners = async () => {
      const { data } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name, status, home_lat, home_lng, pay_rate_hr, max_travel_miles")
        .eq("approved", true)
        .eq("status", "active")
        .order("first_name");
      // Deduplicate by id
      const unique = (data || []).filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i);
      setCleaners(unique);
    };
    fetchCleaners();
  }, [isAuthenticated]);

  // Auto-calc duration
  useEffect(() => {
    if (homeSizeId && serviceType) {
      const hs = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
      if (hs) setEstimatedDuration(calculateServiceDuration(homeSizeId, serviceType, hs.baseHours).toString());
    }
  }, [homeSizeId, serviceType]);

  // Auto-disable $99 promo if service type changes away from standard
  useEffect(() => {
    if (serviceType !== "standard" && applyFirstCleanPromo) {
      setApplyFirstCleanPromo(false);
      setCustomDiscount(0);
    }
  }, [serviceType]);

  // Auto-calculate discount when $99 promo is toggled
  useEffect(() => {
    if (applyFirstCleanPromo && homeSizeId && serviceType === "standard") {
      const pricing = calculatePrice(homeSizeId, "standard", [], "none", false, false);
      const regularPrice = pricing.total / 100;
      const discount = Math.max(0, regularPrice - FIRST_CLEAN_PROMO.price);
      setCustomDiscount(discount);
    } else if (!applyFirstCleanPromo) {
      // Only reset if the discount matches a promo-calculated value
      const pricing = homeSizeId ? calculatePrice(homeSizeId, "standard", [], "none", false, false) : null;
      if (pricing) {
        const expectedDiscount = Math.max(0, (pricing.total / 100) - FIRST_CLEAN_PROMO.price);
        if (customDiscount === expectedDiscount) {
          setCustomDiscount(0);
        }
      }
    }
  }, [applyFirstCleanPromo, homeSizeId]);

  // Customer recognition
  useEffect(() => {
    if (!email || !email.includes("@")) return;
    const t = setTimeout(async () => {
      setCheckingCustomer(true);
      try {
        const { data: customer } = await supabase.from("customers").select("*").eq("email", email).maybeSingle();
        const { data: membership } = await supabase.from("membership_credits").select("*").eq("email", email)
          .gt("current_period_end", new Date().toISOString()).order("current_period_end", { ascending: false }).maybeSingle();
        if (!customer) {
          setCustomerStatus({ isNew: true, hasMembership: false });
        } else if (membership) {
          setCustomerStatus({
            isNew: false, hasMembership: true, membershipPlan: membership.membership_plan,
            creditsRemaining: membership.credits_remaining, creditsPerMonth: membership.credits_per_month,
            currentPeriodEnd: membership.current_period_end,
          });
          setMembershipPlan(membership.membership_plan);
        } else {
          setCustomerStatus({ isNew: false, hasMembership: false });
        }
      } catch {} finally { setCheckingCustomer(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [email]);

  // Cleaner distances
  useEffect(() => {
    if (!customerLocation || cleaners.length === 0) return;
    const updated = cleaners.map(c => {
      if (c.home_lat && c.home_lng) {
        const d = calculateDistance(customerLocation.lat, customerLocation.lng, c.home_lat, c.home_lng);
        if (c.max_travel_miles && d > c.max_travel_miles) return null;
        return { ...c, distance: d };
      }
      return c;
    }).filter(Boolean) as Cleaner[];
    updated.sort((a, b) => (a.distance || 9999) - (b.distance || 9999));
    setCleaners(updated);
  }, [customerLocation]);

  const handleAddressSelect = (addr: { street: string; city: string; state: string; zipCode: string; lat: number; lng: number }) => {
    setStreet(addr.street); setCity(addr.city); setState(addr.state); setZipCode(addr.zipCode);
    setCustomerLocation({ lat: addr.lat, lng: addr.lng });
    toast.success("Address selected — calculating distances...");
  };

  // Determine sales step for SalesAssistPanel
  const currentStep = useMemo(() => {
    if (!serviceType) return "service_type";
    if (!homeSizeId) return "home_size";
    if (!zipCode || zipCode.length < 5) return "zip_validation";
    if (!frequency || frequency === "One-Time") return "frequency";
    return "price_presentation";
  }, [serviceType, homeSizeId, zipCode, frequency]);

  const isNewCustomer = customerStatus?.isNew !== false;

  // Profit margin warning
  const profitWarning = useMemo(() => {
    if (!homeSizeId || customDiscount <= 0) return null;
    const pricing = calculatePrice(homeSizeId, serviceType, addOns, 'none', false, false);
    const totalAfterDiscount = pricing.total - (customDiscount * 100) - (promoDiscount * 100);
    if (totalAfterDiscount <= 0) return { margin: 0, warning: true };
    const calc = calculateProfit(totalAfterDiscount / 100, homeSizeId);
    return calc.profitMargin < 0.20 ? { margin: calc.profitMargin, warning: true } : null;
  }, [homeSizeId, serviceType, addOns, customDiscount, promoDiscount]);

  // Promo code handler
  const handleApplyPromo = async () => {
    if (!promoCode.trim()) return;
    setApplyingPromo(true);
    try {
      const pricing = calculatePrice(homeSizeId, serviceType, addOns, 'none', false, false);
      const result = await applyPromoCode(promoCode, pricing.subtotal, homeSizeId, isNewCustomer, email, supabase);
      setPromoMessage(result.message || "");
      setPromoValid(result.valid);
      setPromoDiscount(result.valid ? result.discount : 0);
    } catch {
      setPromoMessage("Error applying promo code");
      setPromoValid(false);
      setPromoDiscount(0);
    } finally {
      setApplyingPromo(false);
    }
  };

  const handleClearPromo = () => {
    setPromoCode("");
    setPromoDiscount(0);
    setPromoMessage("");
    setPromoValid(false);
  };

  // ─── Save Lead ───
  const handleSaveLead = async () => {
    if (!firstName || !lastName) { toast.error("Lead name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        first_name: firstName, last_name: lastName,
        phone: phone || null, email: email || null,
        source: leadSource, channel,
        active_channel: activeChannel, notes: notes || null,
        is_existing_customer: !isNewCustomer,
        service_type: serviceType || null, property_type: dwellingType || null,
        bedrooms: bedrooms ? parseInt(bedrooms) : null,
        bathrooms: bathrooms ? parseFloat(bathrooms) : null,
        zip_code: zipCode || null,
        frequency: frequency || null, preferred_date: serviceDate || null,
        special_requests: accessNotes || null,
      };
      if (isEditing && savedLeadId) {
        const { error } = await supabase.from("leads").update(payload as any).eq("id", savedLeadId);
        if (error) throw error;
        await supabase.from("lead_activity_log").insert({ lead_id: savedLeadId, action: "updated", notes: "Lead updated from Sales Tool" } as any);
        toast.success("Lead updated!");
      } else {
        const { data, error } = await supabase.from("leads").insert({ ...payload, status: "new" } as any).select().single();
        if (error) throw error;
        if (data) {
          setSavedLeadId((data as any).id);
          await supabase.from("lead_activity_log").insert({ lead_id: (data as any).id, action: "created", notes: `Lead created from ${leadSource} via ${channel}` } as any);
        }
        toast.success("Lead saved!");
      }
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch (err: any) { toast.error("Failed to save lead: " + err.message); }
    finally { setSaving(false); }
  };

  // ─── Create Booking ───
  const handleCreateBooking = async () => {
    if (!firstName || !lastName || !email || !phone) { toastHook({ title: "Missing customer info", variant: "destructive" }); return; }
    if (!street || !city || !state || !zipCode) { toastHook({ title: "Missing address", variant: "destructive" }); return; }
    if (!homeSizeId || !serviceType) { toastHook({ title: "Missing service details", variant: "destructive" }); return; }
    if (!serviceDate || !timeSlot) { toastHook({ title: "Missing schedule", variant: "destructive" }); return; }

    setLoading(true);
    try {
      const pricing = calculatePrice(homeSizeId, serviceType, addOns, 'none', false, false);
      const adjustedTotal = Math.max(0, pricing.total - (customDiscount * 100) - (promoDiscount * 100));
      let bookingStatus = "pending_payment";
      if (paymentStatus === "Deposit Paid" || paymentStatus === "Paid in Full") bookingStatus = "confirmed";
      const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
      const estimatedHours = homeSize?.baseHours || 0;

      // Deposit: 50% of total when "Deposit Paid", full amount when "Paid in Full", else 0.
      const depositCentsForBooking =
        paymentStatus === "Paid in Full" ? adjustedTotal
        : paymentStatus === "Deposit Paid" ? Math.round(adjustedTotal * DEPOSIT_PERCENT)
        : 0;

      const { data: booking, error: bookingError } = await supabase.from("bookings").insert({
        first_name: firstName, last_name: lastName, email, phone,
        address: street, city, state, zip_code: zipCode,
        bedrooms: bedrooms ? parseInt(bedrooms) : null, bathrooms: bathrooms ? parseFloat(bathrooms) : null,
        dwelling_type: dwellingType || null, pets,
        home_size_id: homeSizeId, service_type: serviceType, add_ons: addOns, frequency,
        service_date: serviceDate, time_slot: timeSlot,
        estimated_duration_hours: parseInt(estimatedDuration || "0"), arrival_window: arrivalWindow || null,
        base_price_cents: pricing.basePrice, deposit_cents: depositCentsForBooking, total_estimate_cents: adjustedTotal,
        booking_channel: bookingChannel, booker_source: customerSource,
        payment_method: paymentMethod, payment_option: paymentStatus === "Paid in Full" ? "full" : "deposit",
        membership_plan: membershipPlan, status: bookingStatus,
        access_notes: accessNotes || null, team_notes: (applyFirstCleanPromo ? "[🎉 $99 First Clean Promo] " : "") + (teamNotes || ""), dispatch_notes: dispatchNotes || null,
        sdr_rep_name: sdrRepName || null,
        num_cleaners_assigned: numCleaners,
      } as any).select().single();

      if (bookingError) throw bookingError;

      if (selectedCleaners.length > 0 && customerLocation) {
        const { data: job, error: jobError } = await supabase.from("jobs").insert({
          address: street, city, state, zip: zipCode,
          lat: customerLocation.lat, lng: customerLocation.lng,
          service_type: serviceType, start_datetime: `${serviceDate} ${timeSlot.split(" - ")[0]}`,
          duration_est_hours: estimatedHours, min_cleaners_required: selectedCleaners.length,
          status: "Assigned", sq_ft: homeSize?.minSqft || null,
          bedrooms: bedrooms ? parseInt(bedrooms) : null, bathrooms: bathrooms ? parseFloat(bathrooms) : null,
        }).select().single();
        if (jobError) throw jobError;
        await supabase.from("bookings").update({ job_id: job.id }).eq("id", booking.id);
        await supabase.from("job_assignments").insert(
          selectedCleaners.map(c => ({
            job_id: job.id, cleaner_id: c.id, role: c.role, distance_miles: c.distance,
            pay_rate_hr: c.hourlyRate, estimated_pay_cents: c.hourlyRate * estimatedHours * 100, status: "Assigned",
          }))
        );
      }

      try { await supabase.functions.invoke("send-zapier-webhook", { body: { bookingId: booking.id } }); } catch (e) { console.error("Webhook error:", e); }
      try {
        await supabase.functions.invoke("send-booking-email", {
          body: {
            type: "confirmation",
            email,
            data: {
              firstName, lastName, bookingId: booking.id,
              serviceDate, timeSlot, serviceType,
              homeSize: HOME_SIZE_RANGES.find(h => h.id === homeSizeId)?.label || homeSizeId,
              homeSizeId,
              address: street, city, state, zipCode,
              totalAmount: adjustedTotal, depositAmount: depositCentsForBooking,
              balanceAmount: adjustedTotal - depositCentsForBooking,
              paymentOption: paymentStatus === "Paid in Full" ? "full" : "deposit",
              addOns, frequency,
            },
          },
        });
      } catch (e) { console.error("Email error:", e); }
      try {
        await supabase.functions.invoke("create-google-calendar-event", {
          body: { bookingId: booking.id },
        });
      } catch (e) { console.error("Calendar error:", e); }

      // Send all data to GHL webhook
      try {
        const ghlPayload = {
          booking_id: booking.id,
          first_name: firstName, last_name: lastName, email, phone,
          address: street, city, state, zip_code: zipCode,
          bedrooms: bedrooms ? parseInt(bedrooms) : null,
          bathrooms: bathrooms ? parseFloat(bathrooms) : null,
          dwelling_type: dwellingType || null, pets,
          home_size_id: homeSizeId, service_type: serviceType,
          add_ons: addOns, frequency,
          service_date: serviceDate, time_slot: timeSlot,
          estimated_duration_hours: estimatedDuration,
          arrival_window: arrivalWindow || null,
          base_price_cents: pricing.basePrice,
          deposit_cents: depositCentsForBooking,
          total_estimate_cents: adjustedTotal,
          custom_discount: customDiscount,
          promo_code: promoValid ? promoCode : null,
          promo_discount: promoDiscount,
          booking_channel: bookingChannel,
          booker_source: customerSource,
          payment_method: paymentMethod,
          payment_status: paymentStatus,
          sdr_rep_name: sdrRepName || null,
          num_cleaners_assigned: numCleaners,
          access_notes: accessNotes || null,
          team_notes: (applyFirstCleanPromo ? "[🎉 $99 First Clean Promo] " : "") + (teamNotes || ""),
          dispatch_notes: dispatchNotes || null,
          notes: notes || null,
          first_clean_promo: applyFirstCleanPromo,
          lead_source: leadSource,
          contact_channel: channel,
          is_new_customer: isNewCustomer,
          assigned_cleaners: selectedCleaners.map(c => ({
            id: c.id, name: c.name, role: c.role,
            hourly_rate: c.hourlyRate, distance: c.distance,
          })),
        };
        const ghlWebhookUrl = process.env.NEXT_PUBLIC_GHL_BOOKING_WEBHOOK_URL || "https://services.leadconnectorhq.com/hooks/fJddieqJDUjUoYAGOvbk/webhook-trigger/dQxXR74sgYXEvShKnBKO";
        await fetch(ghlWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ghlPayload),
        });
      } catch (e) { console.error("GHL webhook error:", e); }

      localStorage.removeItem("admin_intake_autosave");
      toast.success(`Booking created: ${booking.id}`);
      router.push("/admin/dispatch");
    } catch (err: any) {
      toastHook({ title: "Error creating booking", description: err.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  // ─── PIN Gate ───
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 bg-white border-gray-200">
          <div className="flex flex-col items-center space-y-6">
            <img src="/novara-logo.png" alt="Novara Cleaning" className="h-12 object-contain" />
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: `${BRAND_GREEN}20` }}>
              <RiLockLine className="w-8 h-8" style={{ color: BRAND_GREEN }} />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold text-gray-900 mb-2">Enter Access Code</h1>
              <p className="text-sm text-gray-500">Enter the 4-digit PIN to access the Sales & Intake tool</p>
            </div>
            <div className="flex gap-3">
              {pinCode.map((digit, i) => (
                <Input key={i} id={`sales-pin-${i}`} type="text" inputMode="numeric" maxLength={1}
                  value={digit} onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !digit && i > 0) document.getElementById(`sales-pin-${i - 1}`)?.focus();
                    if (e.key === "Enter" && pinCode.every(d => d)) handlePinSubmit();
                  }}
                  className="w-14 h-14 text-center text-2xl font-semibold bg-white border-gray-300 text-gray-900" autoFocus={i === 0}
                />
              ))}
            </div>
            {pinError && <p className="text-sm text-red-400">Incorrect PIN. Please try again.</p>}
            <Button onClick={handlePinSubmit} disabled={!pinCode.every(d => d)} className="w-full text-white font-semibold" size="lg"
              style={{ backgroundColor: BRAND_GREEN }}>
              Access Sales & Intake
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ─── Main Layout ───
  return (
    <div className="min-h-screen bg-gray-50">
      <SEO title="Sales & Intake" noindex />
      {/* Header */}
      <div className="border-b border-gray-200 bg-white/90 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/novara-logo.png" alt="Novara" className="h-8 object-contain" />
            <div>
              <h1 className="text-lg font-bold text-gray-900">Novara Sales & Intake</h1>
              <p className="text-xs text-gray-500">
                {isEditing ? `Editing: ${firstName} ${lastName}` : "Unified sales & booking tool"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/admin/pipeline")} className="border-gray-300 text-gray-600">
              <RiBarChartBoxLine className="w-4 h-4 mr-1" /> Pipeline
            </Button>
            <Button variant="outline" size="sm" onClick={resetForm} className="border-gray-300 text-gray-600">
              New
            </Button>
            <Button size="sm" onClick={handleSaveLead} disabled={saving || !firstName}
              className="text-white font-semibold" style={{ backgroundColor: BRAND_GREEN }}>
              {saving ? <><RiSaveLine className="w-4 h-4 mr-1 animate-spin" /> Saving...</>
                : isEditing ? <><RiPencilLine className="w-4 h-4 mr-1" /> Update</>
                : savedLeadId ? <><RiCheckboxCircleLine className="w-4 h-4 mr-1" /> Saved</>
                : <><RiSaveLine className="w-4 h-4 mr-1" /> Save Lead</>}
            </Button>
            <Button size="sm" onClick={handleCreateBooking} disabled={loading}
              className="text-white font-semibold" style={{ backgroundColor: BRAND_GREEN }}>
              <RiSaveLine className="w-4 h-4 mr-1" /> {loading ? "Creating..." : "Create Booking"}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 py-6">
        {/* Restore Prompt */}
        {showRestorePrompt && (
          <div className="mb-4 border rounded-lg p-4 flex items-center justify-between" style={{ backgroundColor: `${BRAND_GREEN}10`, borderColor: `${BRAND_GREEN}40` }}>
            <div className="flex items-center gap-2" style={{ color: BRAND_GREEN }}>
              <RiArrowGoBackLine className="w-4 h-4" />
              <span className="text-sm">Unsaved form data from a previous session.</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleDiscardRestore} className="border-gray-300 text-gray-600 text-xs">Discard</Button>
              <Button size="sm" onClick={handleRestore} className="text-white text-xs" style={{ backgroundColor: BRAND_GREEN }}>Restore</Button>
            </div>
          </div>
        )}

        {/* Customer Search */}
        <div className="mb-4">
          <Popover open={searchOpen && searchQuery.length >= 2} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <div className="relative">
                <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search customers, bookings, abandoned carts..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                  onFocus={() => { if (searchQuery.length >= 2) setSearchOpen(true); }}
                  className="pl-10 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-[500px] p-0 bg-white border-gray-200" align="start">
              {searchLoading ? (
                <div className="p-4 text-sm text-gray-500">Searching...</div>
              ) : searchResults && searchResults.length > 0 ? (
                <div className="max-h-64 overflow-y-auto">
                  {searchResults.map((r, i) => (
                    <button key={`${r.email}-${i}`} onClick={() => handleSelectSearchResult(r)}
                      className="w-full p-3 text-left hover:bg-gray-100 border-b border-gray-200 last:border-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-gray-900">{r.firstName} {r.lastName}</p>
                        <Badge variant={r.source === "booking" ? "default" : r.source === "abandoned_cart" ? "secondary" : "outline"}
                          className="text-xs shrink-0 ml-2">
                          {r.badge}{r.bookingCount && r.bookingCount > 1 ? ` (${r.bookingCount}x)` : ""}
                        </Badge>
                      </div>
                      <div className="space-y-0.5">
                        {r.allEmails && r.allEmails.length > 0 ? (
                          <p className="text-xs text-gray-500">
                            📧 {r.allEmails.map((e, idx) => (
                              <span key={e}>{idx === 0 ? <strong>{e}</strong> : e}{idx < r.allEmails.length - 1 ? ", " : ""}</span>
                            ))}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-500">📧 {r.email}</p>
                        )}
                        {r.allPhones && r.allPhones.length > 0 ? (
                          <p className="text-xs text-gray-500">
                            📱 {r.allPhones.map((p, idx) => (
                              <span key={p}>{idx === 0 ? <strong>{p}</strong> : p}{idx < r.allPhones.length - 1 ? ", " : ""}</span>
                            ))}
                          </p>
                        ) : r.phone ? (
                          <p className="text-xs text-gray-500">📱 {r.phone}</p>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              ) : searchQuery.length >= 2 ? (
                <div className="p-4 text-sm text-gray-500">No results found</div>
              ) : null}
            </PopoverContent>
          </Popover>
        </div>

        {/* ─── Unified Form + Sidebar ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          {/* Left: Form */}
          <div className="space-y-6">
            {/* Customer Information */}
            <Card className="bg-white border-gray-200">
              <CardHeader><CardTitle className="text-gray-900">Customer Information</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-600">First Name *</Label>
                    <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="John" className="bg-white border-gray-300 text-gray-900" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-600">Last Name *</Label>
                    <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Smith" className="bg-white border-gray-300 text-gray-900" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-600">Email *</Label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@example.com" className="bg-white border-gray-300 text-gray-900" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-600">Phone *</Label>
                    <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" className="bg-white border-gray-300 text-gray-900" />
                  </div>
                </div>
                {checkingCustomer && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <RiRefreshLine className="w-4 h-4 animate-spin" /> Checking customer status...
                  </div>
                )}
                <CustomerRecognitionCard status={customerStatus} />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-600">Customer Source</Label>
                    <Select value={customerSource} onValueChange={setCustomerSource}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="New Lead">New Lead</SelectItem>
                        <SelectItem value="Member">Member</SelectItem>
                        <SelectItem value="Returning Client">Returning Client</SelectItem>
                        <SelectItem value="Internal">Internal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-600">Lead Source</Label>
                    <Select value={leadSource} onValueChange={setLeadSource}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LEAD_SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-600">Contact Channel</Label>
                    <Select value={channel} onValueChange={(v) => { setChannel(v); setActiveChannel(v); }}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CONTACT_CHANNELS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-600">SDR Rep Name</Label>
                    <Input value={sdrRepName} onChange={(e) => setSdrRepName(e.target.value)}
                      placeholder="e.g., Maria G." className="bg-white border-gray-300 text-gray-900" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Service Address */}
            <Card className="bg-white border-gray-200">
              <CardHeader><CardTitle className="text-gray-900">Service Address</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <AddressAutocomplete onAddressSelect={handleAddressSelect} initialValue={street} />
                <div className="text-xs text-gray-500">Auto-filled from address above</div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2"><Label className="text-gray-600">City *</Label><Input value={city} readOnly className="bg-gray-50 border-gray-300 text-gray-900" /></div>
                  <div className="space-y-2"><Label className="text-gray-600">State *</Label><Input value={state} readOnly className="bg-gray-50 border-gray-300 text-gray-900" /></div>
                  <div className="space-y-2"><Label className="text-gray-600">ZIP *</Label><Input value={zipCode} readOnly className="bg-gray-50 border-gray-300 text-gray-900" maxLength={5} /></div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-2"><Label className="text-gray-600">Bedrooms</Label>
                    <Select value={bedrooms} onValueChange={setBedrooms}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{[1,2,3,4,5,6,7].map(n => <SelectItem key={n} value={n.toString()}>{n}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label className="text-gray-600">Bathrooms</Label>
                    <Select value={bathrooms} onValueChange={setBathrooms}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{["1","1.5","2","2.5","3","3.5","4"].map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label className="text-gray-600">Pets</Label>
                    <Select value={pets} onValueChange={setPets}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="None">None</SelectItem><SelectItem value="Dog(s)">Dog(s)</SelectItem>
                        <SelectItem value="Cat(s)">Cat(s)</SelectItem><SelectItem value="Multiple">Multiple</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label className="text-gray-600">Dwelling Type</Label>
                    <Select value={dwellingType} onValueChange={setDwellingType}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="house">House</SelectItem><SelectItem value="apartment">Apartment</SelectItem>
                        <SelectItem value="condo">Condo</SelectItem><SelectItem value="office_space">Office Space</SelectItem>
                        <SelectItem value="townhouse">Townhouse</SelectItem><SelectItem value="mansion">Mansion</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Service Details */}
            <Card className="bg-white border-gray-200">
              <CardHeader><CardTitle className="text-gray-900">Service Details</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label className="text-gray-600">Home Size *</Label>
                    <Select value={homeSizeId} onValueChange={setHomeSizeId}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue placeholder="Select home size" /></SelectTrigger>
                      <SelectContent>{HOME_SIZE_RANGES.map(s => <SelectItem key={s.id} value={s.id}>{s.label} ({s.baseHours}h)</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label className="text-gray-600">Service Type *</Label>
                    <Select value={serviceType} onValueChange={setServiceType}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard Cleaning</SelectItem>
                        <SelectItem value="deep">Deep Clean (+${SERVICE_TIER_PRICING.deep.addition})</SelectItem>
                        <SelectItem value="moveInOut">Move-In/Out (+${SERVICE_TIER_PRICING.moveInOut.addition})</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {/* Novara Glow Membership */}
                <div className="space-y-3">
                  <Label className="text-gray-600">Novara Glow Membership</Label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {[
                      { value: "One-Time", label: "One-Time", desc: "Pay Per Clean" },
                      { value: "Monthly", label: "Glow Monthly", desc: "1 clean/month" },
                      { value: "Bi-Weekly", label: "Glow Bi-Weekly", desc: "2 cleans/month", popular: true },
                      { value: "Weekly", label: "Glow Weekly", desc: "4 cleans/month" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setFrequency(opt.value)}
                        className={`p-3 rounded-lg border text-center transition-all relative ${
                          frequency === opt.value
                            ? "border-emerald-500 bg-emerald-50 text-gray-900"
                            : "border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-400"
                        }`}
                      >
                        {opt.popular && (
                          <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[10px] px-2 py-0.5 rounded-full font-semibold">Popular</span>
                        )}
                        <div className="font-semibold text-sm">{opt.label}</div>
                        <div className="text-xs text-gray-400 mt-1">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3"><Label className="text-gray-600">Add-ons</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(ADD_ONS).map(([key, addon]) => (
                      <div key={key} className="flex items-center space-x-2">
                        <Checkbox id={`addon-${key}`} checked={addOns.includes(key)}
                          onCheckedChange={() => setAddOns(prev => prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key])} />
                        <label htmlFor={`addon-${key}`} className="text-sm cursor-pointer text-gray-600">{addon.label} (+${addon.price})</label>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Scheduling */}
            <Card className="bg-white border-gray-200">
              <CardHeader><CardTitle className="text-gray-900 flex items-center gap-2"><RiTimeLine className="w-5 h-5" /> Scheduling</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label className="text-gray-600">Service Date *</Label>
                    <Input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className="bg-white border-gray-300 text-gray-900" />
                  </div>
                  <div className="space-y-2"><Label className="text-gray-600">Time Slot *</Label>
                    <Select value={timeSlot} onValueChange={setTimeSlot}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue placeholder="Select time" /></SelectTrigger>
                      <SelectContent>
                        {["8:00 AM","9:00 AM","10:00 AM","11:00 AM","12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM","5:00 PM","6:00 PM"].map(t =>
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label className="text-gray-600">Duration (hours)</Label>
                    <Input type="number" value={estimatedDuration} onChange={(e) => setEstimatedDuration(e.target.value)} placeholder="Auto" className="bg-white border-gray-300 text-gray-900" />
                  </div>
                  <div className="space-y-2"><Label className="text-gray-600">Arrival Window</Label>
                    <Input value={arrivalWindow} onChange={(e) => setArrivalWindow(e.target.value)} placeholder="e.g., 10-11 AM" className="bg-white border-gray-300 text-gray-900" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Booking Configuration */}
            <Card className="bg-white border-gray-200">
              <CardHeader><CardTitle className="text-gray-900 flex items-center gap-2"><RiMoneyDollarCircleLine className="w-5 h-5" /> Booking Configuration</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-2"><Label className="text-gray-600">Booking Channel</Label>
                    <Select value={bookingChannel} onValueChange={setBookingChannel}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Phone","SMS","Facebook","Google","Referral","AI","Other","Website"].map(c =>
                          <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label className="text-gray-600">Payment Method</Label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Card","Cash","ACH","Other"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label className="text-gray-600">Payment Status</Label>
                    <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Unpaid">Unpaid</SelectItem>
                        <SelectItem value="Deposit Paid">Deposit Paid</SelectItem>
                        <SelectItem value="Paid in Full">Paid in Full</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-600">Discount ($)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={customDiscount || ""}
                      onChange={(e) => { setCustomDiscount(parseFloat(e.target.value) || 0); setApplyFirstCleanPromo(false); }}
                      placeholder="0"
                      className="bg-white border-gray-300 text-gray-900"
                      disabled={applyFirstCleanPromo}
                    />
                    <p className="text-xs text-gray-400">Manual dollar discount</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-600">Promo Code</Label>
                    <div className="flex gap-2">
                      <Input
                        value={promoCode}
                        onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                        placeholder="e.g. SAVE20"
                        className="bg-white border-gray-300 text-gray-900"
                        disabled={promoValid}
                      />
                      {promoValid ? (
                        <Button variant="outline" size="sm" onClick={handleClearPromo} className="shrink-0 border-gray-300 text-gray-600">
                          Clear
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={handleApplyPromo} disabled={applyingPromo || !promoCode.trim()} className="shrink-0 border-gray-300 text-gray-600">
                          {applyingPromo ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <RiPriceTag3Line className="w-4 h-4" />}
                        </Button>
                      )}
                    </div>
                    {promoMessage && (
                      <p className={`text-xs ${promoValid ? "text-green-600" : "text-red-500"}`}>{promoMessage}</p>
                    )}
                    {promoValid && promoDiscount > 0 && (
                      <p className="text-xs text-green-600 font-medium">-${promoDiscount.toFixed(2)} applied</p>
                    )}
                  </div>
                </div>

                {/* $99 First Clean Promo Toggle */}
                {FIRST_CLEAN_PROMO.enabled && customerStatus?.isNew && serviceType === "standard" && (
                  <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-2">
                    <div className="flex items-center space-x-3">
                      <Checkbox
                        id="first-clean-promo"
                        checked={applyFirstCleanPromo}
                        onCheckedChange={(checked) => setApplyFirstCleanPromo(checked === true)}
                      />
                      <label htmlFor="first-clean-promo" className="text-sm font-semibold text-amber-800 cursor-pointer">
                        🎉 Apply {FIRST_CLEAN_PROMO.label} Promo
                      </label>
                    </div>
                    <p className="text-xs text-amber-700 ml-7">{FIRST_CLEAN_PROMO.description}</p>
                    {applyFirstCleanPromo && (
                      <p className="text-xs text-amber-800 ml-7 font-medium">
                        Discount auto-set to ${customDiscount.toFixed(2)} → Final price: ${FIRST_CLEAN_PROMO.price}
                      </p>
                    )}
                  </div>
                )}

                {profitWarning && (
                  <Alert variant="destructive" className="border-red-300 bg-red-50">
                    <RiAlertLine className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      ⚠️ Profit margin is {(profitWarning.margin * 100).toFixed(0)}% — below the 20% minimum. Reduce the discount or increase the price.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Notes */}
            <Card className="bg-white border-gray-200">
              <CardHeader><CardTitle className="text-gray-900">Notes</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2"><Label className="text-gray-600">General Notes</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Jot anything — pain points, timeline, specific needs..." rows={3} className="bg-white border-gray-300 text-gray-900" />
                </div>
                <div className="space-y-2"><Label className="text-gray-600">Access Notes</Label>
                  <Textarea value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} placeholder="Gate codes, key locations..." rows={3} className="bg-white border-gray-300 text-gray-900" />
                </div>
                <div className="space-y-2"><Label className="text-gray-600">Team Notes (Internal)</Label>
                  <Textarea value={teamNotes} onChange={(e) => setTeamNotes(e.target.value)} placeholder="Internal notes" rows={3} className="bg-white border-gray-300 text-gray-900" />
                </div>
                <div className="space-y-2"><Label className="text-gray-600">Dispatch Notes (Cleaner-Facing)</Label>
                  <Textarea value={dispatchNotes} onChange={(e) => setDispatchNotes(e.target.value)} placeholder="Notes for cleaner" rows={3} className="bg-white border-gray-300 text-gray-900" />
                </div>
              </CardContent>
            </Card>

            {/* Cleaner Team Assignment */}
            <Card className="bg-white border-gray-200">
              <CardHeader>
                <CardTitle className="text-gray-900 flex items-center gap-2">
                  <RiGroupLine className="w-5 h-5" /> Cleaner Team Assignment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-gray-600">Number of Cleaners</Label>
                    <Select value={numCleaners.toString()} onValueChange={(v) => setNumCleaners(parseInt(v))}>
                      <SelectTrigger className="bg-white border-gray-300 text-gray-900"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 Cleaner</SelectItem>
                        <SelectItem value="2">2 Cleaners</SelectItem>
                        <SelectItem value="3">3 Cleaners</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-400">Auto-calculated from home size (editable)</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-600">Pay Rate</Label>
                    <Input value="$18/hr" readOnly className="bg-gray-50 border-gray-300 text-gray-900" />
                    <p className="text-xs text-gray-400">Fixed rate for all cleaners</p>
                  </div>
                </div>
                <CleanerMultiSelect
                  cleaners={cleaners}
                  selectedCleaners={selectedCleaners}
                  onSelectionChange={setSelectedCleaners}
                  maxCleaners={numCleaners}
                  onCleanerDeleted={(id) => setCleaners(prev => prev.filter(c => c.id !== id))}
                />
              </CardContent>
            </Card>
          </div>

          {/* Right: Sticky Sidebar */}
          <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            {/* Live Quote */}
            <Card className="bg-white border-gray-200 p-4">
              <LiveQuotePanel
                homeSizeId={homeSizeId}
                serviceType={serviceType}
                frequency={frequency}
                addOns={addOns}
                customDiscount={customDiscount + promoDiscount}
                bedrooms={bedrooms ? parseInt(bedrooms) : undefined}
                bathrooms={bathrooms ? parseFloat(bathrooms) : undefined}
                leadEmail={email}
                leadId={savedLeadId}
                leadFirstName={firstName}
                onStatusAdvance={(s) => toast.info(`Lead status → "${s}"`)}
                firstCleanPromo={applyFirstCleanPromo}
              />
            </Card>

            {/* Pricing Breakdown */}
            <IntakePricingSidebar
              homeSizeId={homeSizeId}
              serviceType={serviceType}
              addOns={addOns}
              membershipPlan="none"
              customDiscount={customDiscount + promoDiscount}
              selectedCleaners={selectedCleaners}
              estimatedHours={parseFloat(estimatedDuration || "0")}
              firstCleanPromo={applyFirstCleanPromo}
            />

            {/* Sales Assist */}
            <Card className="bg-white border-gray-200 p-4">
              <SalesAssistPanel activeChannel={activeChannel} currentStep={currentStep} />
            </Card>

            {/* Follow-Up Scheduler */}
            {savedLeadId && (
              <Card className="bg-white border-gray-200 p-4">
                <FollowUpScheduler leadId={savedLeadId} leadName={firstName || "there"} activeChannel={activeChannel} />
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
