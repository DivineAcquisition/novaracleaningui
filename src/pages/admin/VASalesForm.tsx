import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { 
  ArrowLeft, Save, Clock, DollarSign, Lock, RefreshCw, Trash2, 
  Phone, User, MapPin, Sparkles, Calendar, CheckCircle, XCircle,
  AlertTriangle, Target, TrendingUp, Gift, Send, Copy, ExternalLink,
  MessageSquare, Headphones, ChevronDown, ChevronUp, Zap, Star,
  Timer, Percent, CreditCard, Tag, Users, FileText, PhoneCall,
  ThumbsUp, ThumbsDown, BarChart3, Lightbulb
} from "lucide-react";

import { US_STATES } from "@/lib/us-states";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING, ADD_ONS, MEMBERSHIP_PLANS, calculatePrice, NEW_CUSTOMER_DISCOUNT, DEPOSIT_AMOUNT, calculateFullPaymentWithDiscount } from "@/lib/pricing-system";
import { IntakePricingSidebar } from "@/components/admin/IntakePricingSidebar";
import { calculateServiceDuration } from "@/lib/time-slots";
import { CleanerMultiSelect, SelectedCleaner } from "@/components/admin/CleanerMultiSelect";
import { CustomerRecognitionCard, CustomerStatus } from "@/components/admin/CustomerRecognitionCard";
import { calculateDistance } from "@/lib/distance-calculator";
import { AddressAutocomplete } from "@/components/admin/AddressAutocomplete";
import { cn } from "@/lib/utils";

const ACCESS_PIN = "1234";

// Sales-specific constants
const LEAD_SOURCES = [
  { value: "inbound_call", label: "Inbound Call", icon: PhoneCall },
  { value: "outbound_call", label: "Outbound Call", icon: Phone },
  { value: "callback", label: "Callback Request", icon: RefreshCw },
  { value: "referral", label: "Customer Referral", icon: Users },
  { value: "google_lsa", label: "Google LSA", icon: Target },
  { value: "google_ads", label: "Google Ads", icon: TrendingUp },
  { value: "facebook", label: "Facebook/Meta", icon: Users },
  { value: "website_chat", label: "Website Chat", icon: MessageSquare },
  { value: "sms", label: "SMS Inquiry", icon: MessageSquare },
  { value: "email", label: "Email Inquiry", icon: Send },
  { value: "yelp", label: "Yelp", icon: Star },
  { value: "nextdoor", label: "Nextdoor", icon: MapPin },
  { value: "other", label: "Other", icon: FileText },
];

const CALL_OUTCOMES = [
  { value: "booked", label: "Booked", color: "bg-green-500", description: "Customer scheduled a service" },
  { value: "quote_sent", label: "Quote Sent", color: "bg-blue-500", description: "Sent quote, awaiting decision" },
  { value: "follow_up", label: "Follow Up Required", color: "bg-yellow-500", description: "Needs callback to close" },
  { value: "not_interested", label: "Not Interested", color: "bg-red-500", description: "Declined service" },
  { value: "out_of_area", label: "Out of Service Area", color: "bg-gray-500", description: "Location not serviced" },
  { value: "price_objection", label: "Price Objection", color: "bg-orange-500", description: "Too expensive for customer" },
  { value: "schedule_conflict", label: "Schedule Conflict", color: "bg-purple-500", description: "No suitable time available" },
  { value: "voicemail", label: "Left Voicemail", color: "bg-slate-500", description: "No answer, left message" },
  { value: "wrong_number", label: "Wrong Number", color: "bg-gray-400", description: "Invalid contact" },
];

const OBJECTION_HANDLERS: Record<string, { objection: string; response: string }[]> = {
  price: [
    { objection: "That's too expensive", response: "I understand price is important. Let me share that we're currently offering $60 off your first cleaning, which brings your total to just [PRICE]. Plus, our Google Guarantee means you're protected if you're not satisfied." },
    { objection: "Can you do better on price?", response: "We pride ourselves on fair, transparent pricing. What I can offer is our new customer discount of $60 off, and if you pay in full today, you'll save an additional 10%." },
    { objection: "I found cheaper online", response: "I appreciate you doing research! Keep in mind we're Google Guaranteed, fully insured, and our cleaners are background-checked professionals. Would you like me to walk you through what's included in our service?" },
  ],
  timing: [
    { objection: "I need to think about it", response: "Absolutely, this is an important decision. Can I send you a detailed quote to review? And what day works best for a quick follow-up call?" },
    { objection: "Not a good time", response: "No problem at all! When would be a better time for me to call back? I'd love to help you find the perfect cleaning solution." },
  ],
  trust: [
    { objection: "How do I know you're reliable?", response: "Great question! We're a Google Guaranteed business, which means Google has verified us and backs our work up to $2,000. We also have 4.8+ star reviews and all cleaners are background-checked." },
    { objection: "What if I'm not satisfied?", response: "Your satisfaction is our priority. If you're not happy, we'll come back and re-clean at no charge. Plus, our Google Guarantee provides additional protection." },
  ],
};

const URGENCY_OFFERS = [
  { id: "same_week", label: "Same Week Availability", discount: 0, description: "Book this week - limited slots!" },
  { id: "first_time", label: "$60 New Customer Discount", discount: 60, description: "Already applied for first-time customers" },
  { id: "pay_full", label: "10% Off Pay In Full", discount: 10, description: "Save when paying full amount today" },
  { id: "membership", label: "Membership Savings", discount: 15, description: "Up to 30% off with recurring service" },
];

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

export default function VASalesForm() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);

  // PIN Authentication
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinCode, setPinCode] = useState(["", "", "", ""]);
  const [pinError, setPinError] = useState(false);

  // Call Timer
  const [callStartTime, setCallStartTime] = useState<Date | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isCallActive, setIsCallActive] = useState(false);

  // Sales Mode
  const [salesMode, setSalesMode] = useState<"quick" | "detailed">("quick");
  const [activeTab, setActiveTab] = useState("customer");

  // Customer Recognition
  const [customerStatus, setCustomerStatus] = useState<CustomerStatus | null>(null);
  const [checkingCustomer, setCheckingCustomer] = useState(false);

  // Multi-Cleaner Assignment
  const [selectedCleaners, setSelectedCleaners] = useState<SelectedCleaner[]>([]);
  const [customerLocation, setCustomerLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Lead Scoring
  const [leadScore, setLeadScore] = useState(0);
  const [leadTemperature, setLeadTemperature] = useState<"hot" | "warm" | "cold">("warm");

  // Section 1: Customer Information
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [leadSource, setLeadSource] = useState("inbound_call");

  // Section 2: Service Address
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("MD");
  const [zipCode, setZipCode] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [dwellingType, setDwellingType] = useState("");
  const [pets, setPets] = useState("None");

  // Section 3: Service Details
  const [homeSizeId, setHomeSizeId] = useState("");
  const [serviceType, setServiceType] = useState("standard");
  const [addOns, setAddOns] = useState<string[]>([]);
  const [frequency, setFrequency] = useState("One-Time");

  // Section 4: Scheduling
  const [serviceDate, setServiceDate] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [estimatedDuration, setEstimatedDuration] = useState("");
  const [arrivalWindow, setArrivalWindow] = useState("");
  const [flexibleSchedule, setFlexibleSchedule] = useState(false);

  // Section 5: Sales Configuration
  const [callOutcome, setCallOutcome] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [paymentOption, setPaymentOption] = useState<"deposit" | "full">("deposit");
  const [paymentMethod, setPaymentMethod] = useState("Card");
  const [membershipPlan, setMembershipPlan] = useState("none");
  const [applyNewCustomerDiscount, setApplyNewCustomerDiscount] = useState(true);
  
  // Custom Discounts
  const [customDiscountEnabled, setCustomDiscountEnabled] = useState(false);
  const [customDiscountType, setCustomDiscountType] = useState<"percent" | "amount">("amount");
  const [customDiscountValue, setCustomDiscountValue] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  
  // Promo/Referral
  const [promoCode, setPromoCode] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [appliedPromoDiscount, setAppliedPromoDiscount] = useState(0);
  const [appliedReferralDiscount, setAppliedReferralDiscount] = useState(0);

  // Section 6: Notes
  const [accessNotes, setAccessNotes] = useState("");
  const [teamNotes, setTeamNotes] = useState("");
  const [callNotes, setCallNotes] = useState("");

  // UI State
  const [showObjectionHelper, setShowObjectionHelper] = useState(false);
  const [selectedObjectionCategory, setSelectedObjectionCategory] = useState<string | null>(null);
  const [showScriptPrompts, setShowScriptPrompts] = useState(false);
  const [paymentLinkGenerated, setPaymentLinkGenerated] = useState(false);
  const [paymentLink, setPaymentLink] = useState("");

  // Check authentication on mount
  useEffect(() => {
    const hasAccess = sessionStorage.getItem("va_sales_access");
    if (hasAccess === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  // Call timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isCallActive && callStartTime) {
      interval = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartTime.getTime()) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isCallActive, callStartTime]);

  // Fetch cleaners
  useEffect(() => {
    if (isAuthenticated) {
      fetchCleaners();
    }
  }, [isAuthenticated]);

  // Calculate duration when service details change
  useEffect(() => {
    if (homeSizeId && serviceType) {
      const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
      if (homeSize) {
        const duration = calculateServiceDuration(homeSizeId, serviceType, homeSize.baseHours);
        setEstimatedDuration(duration.toString());
      }
    }
  }, [homeSizeId, serviceType]);

  // Customer recognition on email/phone change
  useEffect(() => {
    if (email && email.includes('@')) {
      const debounce = setTimeout(() => {
        checkCustomerStatus(email);
      }, 500);
      return () => clearTimeout(debounce);
    }
  }, [email]);

  // Lead scoring calculation
  useEffect(() => {
    calculateLeadScore();
  }, [firstName, lastName, email, phone, homeSizeId, serviceDate, customerStatus, leadSource]);

  // Update cleaner distances when location changes
  useEffect(() => {
    if (customerLocation && cleaners.length > 0) {
      calculateCleanerDistances();
    }
  }, [customerLocation, cleaners]);

  const formatCallDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const startCall = () => {
    setCallStartTime(new Date());
    setIsCallActive(true);
  };

  const endCall = () => {
    setIsCallActive(false);
  };

  const calculateLeadScore = () => {
    let score = 0;
    
    // Contact info completeness (25 points)
    if (firstName) score += 5;
    if (lastName) score += 5;
    if (email && email.includes('@')) score += 8;
    if (phone && phone.length >= 10) score += 7;
    
    // Service interest (30 points)
    if (homeSizeId) score += 10;
    if (serviceType !== 'standard') score += 5;
    if (serviceDate) score += 15;
    
    // Engagement signals (25 points)
    if (customerStatus?.isNew === false) score += 10; // Returning customer
    if (customerStatus?.hasMembership) score += 15;
    if (leadSource === 'referral') score += 10;
    if (leadSource === 'google_lsa') score += 8;
    
    // Urgency indicators (20 points)
    if (serviceDate) {
      const daysUntilService = Math.ceil((new Date(serviceDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysUntilService <= 3) score += 20;
      else if (daysUntilService <= 7) score += 15;
      else if (daysUntilService <= 14) score += 10;
    }
    
    setLeadScore(Math.min(100, score));
    
    // Set temperature
    if (score >= 70) setLeadTemperature("hot");
    else if (score >= 40) setLeadTemperature("warm");
    else setLeadTemperature("cold");
  };

  const checkCustomerStatus = async (emailToCheck: string) => {
    setCheckingCustomer(true);
    try {
      const { data: customer } = await supabase
        .from("customers")
        .select("*")
        .eq("email", emailToCheck)
        .maybeSingle();

      const { data: membership } = await supabase
        .from("membership_credits")
        .select("*")
        .eq("email", emailToCheck)
        .gt("current_period_end", new Date().toISOString())
        .order("current_period_end", { ascending: false })
        .maybeSingle();

      // Check booking history
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, status, service_date, total_estimate_cents")
        .eq("email", emailToCheck)
        .in("status", ["confirmed", "completed"])
        .order("service_date", { ascending: false })
        .limit(5);

      if (!customer) {
        setCustomerStatus({ isNew: true, hasMembership: false });
        setApplyNewCustomerDiscount(true);
      } else if (membership) {
        setCustomerStatus({
          isNew: false,
          hasMembership: true,
          membershipPlan: membership.membership_plan,
          creditsRemaining: membership.credits_remaining,
          creditsPerMonth: membership.credits_per_month,
          currentPeriodEnd: membership.current_period_end,
        });
        setMembershipPlan(membership.membership_plan);
        setApplyNewCustomerDiscount(false);
      } else {
        setCustomerStatus({ 
          isNew: false, 
          hasMembership: false,
        });
        setApplyNewCustomerDiscount(false);
      }
    } catch (error) {
      console.error("Error checking customer status:", error);
    } finally {
      setCheckingCustomer(false);
    }
  };

  const handleAddressSelect = (addressData: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    lat: number;
    lng: number;
  }) => {
    setStreet(addressData.street);
    setCity(addressData.city);
    setState(addressData.state);
    setZipCode(addressData.zipCode);
    setCustomerLocation({ lat: addressData.lat, lng: addressData.lng });
  };

  const calculateCleanerDistances = () => {
    if (!customerLocation) return;

    const updated = cleaners.map(cleaner => {
      if (cleaner.home_lat && cleaner.home_lng) {
        const distance = calculateDistance(
          customerLocation.lat,
          customerLocation.lng,
          cleaner.home_lat,
          cleaner.home_lng
        );

        if (cleaner.max_travel_miles && distance > cleaner.max_travel_miles) {
          return null;
        }

        return { ...cleaner, distance };
      }
      return cleaner;
    }).filter(Boolean) as Cleaner[];

    updated.sort((a, b) => {
      const distA = a.distance || 9999;
      const distB = b.distance || 9999;
      return distA - distB;
    });

    setCleaners(updated);
  };

  const fetchCleaners = async () => {
    try {
      const { data, error } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name, status, home_lat, home_lng, pay_rate_hr, max_travel_miles")
        .eq("approved", true)
        .order("first_name");

      if (error) throw error;
      setCleaners(data || []);
    } catch (error: any) {
      console.error("Error fetching cleaners:", error);
    }
  };

  const handleAddOnToggle = (addonId: string) => {
    setAddOns(prev =>
      prev.includes(addonId)
        ? prev.filter(id => id !== addonId)
        : [...prev, addonId]
    );
  };

  const handlePinChange = (index: number, value: string) => {
    if (value.length > 1) return;
    if (value && !/^\d$/.test(value)) return;

    const newPin = [...pinCode];
    newPin[index] = value;
    setPinCode(newPin);
    setPinError(false);

    if (value && index < 3) {
      const nextInput = document.getElementById(`va-pin-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handlePinSubmit = () => {
    const enteredPin = pinCode.join("");
    if (enteredPin === ACCESS_PIN) {
      sessionStorage.setItem("va_sales_access", "true");
      setIsAuthenticated(true);
      setPinError(false);
      startCall();
    } else {
      setPinError(true);
      setPinCode(["", "", "", ""]);
      document.getElementById("va-pin-0")?.focus();
    }
  };

  const validateForm = () => {
    if (!firstName || !phone) {
      toast({ title: "Missing customer info", description: "Please fill in name and phone", variant: "destructive" });
      return false;
    }
    if (!homeSizeId) {
      toast({ title: "Missing service details", description: "Please select home size", variant: "destructive" });
      return false;
    }
    return true;
  };

  // Calculate total discount
  const calculateTotalDiscount = () => {
    let discount = 0;
    if (applyNewCustomerDiscount && customerStatus?.isNew) {
      discount += NEW_CUSTOMER_DISCOUNT;
    }
    if (customDiscountEnabled && customDiscountValue > 0) {
      if (customDiscountType === "amount") {
        discount += customDiscountValue;
      } else {
        const pricing = calculatePrice(homeSizeId, serviceType, addOns, membershipPlan, false, false, 0);
        discount += (pricing.subtotal * customDiscountValue) / 100;
      }
    }
    discount += appliedPromoDiscount;
    discount += appliedReferralDiscount;
    return discount;
  };

  // Get pricing for display
  const getPricing = () => {
    const totalDiscount = calculateTotalDiscount();
    const isNewCustomer = customerStatus?.isNew ?? true;
    
    if (paymentOption === "full") {
      return calculateFullPaymentWithDiscount(
        homeSizeId, 
        serviceType, 
        addOns, 
        membershipPlan, 
        false, 
        isNewCustomer && applyNewCustomerDiscount,
        totalDiscount - (applyNewCustomerDiscount && isNewCustomer ? NEW_CUSTOMER_DISCOUNT : 0)
      );
    }
    
    return calculatePrice(
      homeSizeId, 
      serviceType, 
      addOns, 
      membershipPlan, 
      false, 
      isNewCustomer && applyNewCustomerDiscount,
      totalDiscount - (applyNewCustomerDiscount && isNewCustomer ? NEW_CUSTOMER_DISCOUNT : 0)
    );
  };

  const generatePaymentLink = async () => {
    // In a real implementation, this would call a backend function
    const pricing = getPricing();
    const amount = paymentOption === "full" 
      ? ('finalAmount' in pricing ? pricing.finalAmount : pricing.total)
      : pricing.deposit;
    
    // Simulated payment link generation
    const mockLink = `https://pay.novara.com/checkout/${Date.now()}?amount=${amount}&customer=${encodeURIComponent(email || phone)}`;
    setPaymentLink(mockLink);
    setPaymentLinkGenerated(true);
    
    toast({
      title: "Payment Link Generated",
      description: "Link copied to clipboard and ready to send!",
    });
    
    await navigator.clipboard.writeText(mockLink);
  };

  const handleQuickBook = async () => {
    if (!validateForm()) return;
    
    setLoading(true);
    try {
      const pricing = getPricing();
      const totalDiscount = calculateTotalDiscount();
      
      const { data: booking, error } = await supabase
        .from("bookings")
        .insert({
          first_name: firstName,
          last_name: lastName || "Customer",
          email: email || `${phone.replace(/\D/g, '')}@phone.placeholder`,
          phone: phone,
          address: street || "TBD",
          city: city || "TBD",
          state: state,
          zip_code: zipCode || "00000",
          bedrooms: bedrooms ? parseInt(bedrooms) : null,
          bathrooms: bathrooms ? parseFloat(bathrooms) : null,
          dwelling_type: dwellingType || null,
          pets: pets,
          home_size_id: homeSizeId,
          service_type: serviceType,
          add_ons: addOns,
          frequency: frequency,
          service_date: serviceDate || new Date().toISOString().split('T')[0],
          time_slot: timeSlot || "TBD",
          estimated_duration_hours: parseInt(estimatedDuration || "0"),
          base_price_cents: ('basePrice' in pricing ? pricing.basePrice : pricing.originalTotal) * 100,
          deposit_cents: DEPOSIT_AMOUNT * 100,
          total_estimate_cents: ('total' in pricing ? pricing.total : pricing.finalAmount) * 100,
          booking_channel: "Phone",
          booker_source: leadSource,
          payment_method: paymentMethod,
          payment_option: paymentOption,
          membership_plan: membershipPlan,
          status: "pending_payment",
          access_notes: accessNotes || null,
          team_notes: [
            callNotes,
            discountReason ? `Custom discount: ${discountReason}` : null,
            `Lead Score: ${leadScore}%`,
            `Call Duration: ${formatCallDuration(callDuration)}`,
          ].filter(Boolean).join("\n") || null,
        })
        .select()
        .single();

      if (error) throw error;

      endCall();
      
      toast({
        title: "Booking Created!",
        description: `Booking #${booking.id.slice(-6)} created. Call outcome: ${callOutcome || 'Booked'}`,
      });

      // Clear form for next call
      clearForm();
      
    } catch (error: any) {
      console.error("Error creating booking:", error);
      toast({
        title: "Error creating booking",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFollowUp = async () => {
    if (!firstName || !phone) {
      toast({ title: "Missing info", description: "Need name and phone for follow-up", variant: "destructive" });
      return;
    }

    // Save to abandoned_carts or a follow-up table
    try {
      const { error } = await supabase
        .from("abandoned_carts")
        .upsert({
          email: email || `${phone.replace(/\D/g, '')}@followup.placeholder`,
          first_name: firstName,
          last_name: lastName,
          phone: phone,
          home_size: homeSizeId,
          service_type: serviceType,
          zip_code: zipCode,
          last_step: "va_sales_form",
          booking_data: {
            leadSource,
            callNotes,
            followUpDate,
            followUpTime,
            followUpNotes,
            leadScore,
            callDuration,
            callOutcome,
          },
        });

      if (error) throw error;

      endCall();
      
      toast({
        title: "Follow-up Saved",
        description: `Follow-up scheduled for ${followUpDate} at ${followUpTime}`,
      });

      clearForm();
    } catch (error: any) {
      console.error("Error saving follow-up:", error);
      toast({
        title: "Error saving follow-up",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const clearForm = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setStreet("");
    setCity("");
    setState("MD");
    setZipCode("");
    setBedrooms("");
    setBathrooms("");
    setDwellingType("");
    setPets("None");
    setHomeSizeId("");
    setServiceType("standard");
    setAddOns([]);
    setFrequency("One-Time");
    setServiceDate("");
    setTimeSlot("");
    setEstimatedDuration("");
    setCallOutcome("");
    setFollowUpDate("");
    setFollowUpTime("");
    setFollowUpNotes("");
    setCallNotes("");
    setAccessNotes("");
    setTeamNotes("");
    setCustomerStatus(null);
    setLeadScore(0);
    setCustomDiscountEnabled(false);
    setCustomDiscountValue(0);
    setPaymentLinkGenerated(false);
    setPaymentLink("");
    setCallStartTime(new Date());
    setCallDuration(0);
    setIsCallActive(true);
    setSelectedCleaners([]);
  };

  // PIN Entry Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-slate-800/50 border-slate-700 backdrop-blur-sm">
          <CardContent className="pt-8 pb-8">
            <div className="flex flex-col items-center space-y-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <Headphones className="w-10 h-10 text-white" />
              </div>
              
              <div className="text-center">
                <h1 className="text-2xl font-bold text-white mb-2">
                  Novara VA Sales Portal
                </h1>
                <p className="text-sm text-slate-400">
                  Enter your access code to begin taking calls
                </p>
              </div>

              <div className="flex gap-3">
                {pinCode.map((digit, index) => (
                  <Input
                    key={index}
                    id={`va-pin-${index}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handlePinChange(index, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !digit && index > 0) {
                        document.getElementById(`va-pin-${index - 1}`)?.focus();
                      }
                      if (e.key === "Enter" && pinCode.every(d => d)) {
                        handlePinSubmit();
                      }
                    }}
                    className="w-14 h-14 text-center text-2xl font-bold bg-slate-700 border-slate-600 text-white focus:border-emerald-500 focus:ring-emerald-500"
                    autoFocus={index === 0}
                  />
                ))}
              </div>

              {pinError && (
                <p className="text-sm text-red-400 flex items-center gap-2">
                  <XCircle className="w-4 h-4" />
                  Incorrect PIN. Please try again.
                </p>
              )}

              <Button
                onClick={handlePinSubmit}
                disabled={!pinCode.every(d => d)}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold"
                size="lg"
              >
                <Phone className="w-5 h-5 mr-2" />
                Start Taking Calls
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const pricing = getPricing();
  const displayAmount = paymentOption === "full" 
    ? ('finalAmount' in pricing ? pricing.finalAmount : pricing.total)
    : ('deposit' in pricing ? pricing.deposit : DEPOSIT_AMOUNT);

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Sticky Header */}
      <div className="sticky top-0 z-50 border-b border-slate-700 bg-slate-900/95 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => navigate("/admin/dispatch")}
                className="text-slate-400 hover:text-white"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                  <Headphones className="w-5 h-5 text-emerald-500" />
                  VA Sales Portal
                </h1>
                <p className="text-xs text-slate-400">Novara Phone Sales</p>
              </div>
            </div>

            {/* Call Timer & Lead Score */}
            <div className="flex items-center gap-4">
              {/* Call Timer */}
              <div className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full",
                isCallActive ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700 text-slate-400"
              )}>
                <Timer className="w-4 h-4" />
                <span className="font-mono font-bold">{formatCallDuration(callDuration)}</span>
                {isCallActive ? (
                  <Button size="sm" variant="ghost" onClick={endCall} className="h-6 px-2 text-red-400 hover:text-red-300">
                    End
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={startCall} className="h-6 px-2 text-emerald-400 hover:text-emerald-300">
                    Start
                  </Button>
                )}
              </div>

              {/* Lead Score */}
              <div className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full",
                leadTemperature === "hot" && "bg-red-500/20 text-red-400",
                leadTemperature === "warm" && "bg-yellow-500/20 text-yellow-400",
                leadTemperature === "cold" && "bg-blue-500/20 text-blue-400"
              )}>
                <Target className="w-4 h-4" />
                <span className="font-bold">{leadScore}%</span>
                <Badge variant="outline" className={cn(
                  "text-xs border-0",
                  leadTemperature === "hot" && "bg-red-500/30 text-red-300",
                  leadTemperature === "warm" && "bg-yellow-500/30 text-yellow-300",
                  leadTemperature === "cold" && "bg-blue-500/30 text-blue-300"
                )}>
                  {leadTemperature.toUpperCase()}
                </Badge>
              </div>

              {/* Quick Actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowObjectionHelper(!showObjectionHelper)}
                  className="border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  <Lightbulb className="w-4 h-4 mr-1" />
                  Objections
                </Button>
                <Button
                  onClick={handleQuickBook}
                  disabled={loading || !homeSizeId}
                  className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Quick Book
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Objection Handler Drawer */}
      {showObjectionHelper && (
        <div className="border-b border-slate-700 bg-slate-800/50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex gap-4">
              <div className="space-y-2">
                <p className="text-xs text-slate-400 uppercase tracking-wider">Select Objection Type</p>
                <div className="flex gap-2">
                  {Object.keys(OBJECTION_HANDLERS).map(category => (
                    <Button
                      key={category}
                      size="sm"
                      variant={selectedObjectionCategory === category ? "default" : "outline"}
                      onClick={() => setSelectedObjectionCategory(category)}
                      className={selectedObjectionCategory === category 
                        ? "bg-emerald-600" 
                        : "border-slate-600 text-slate-300"
                      }
                    >
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
              {selectedObjectionCategory && (
                <div className="flex-1 space-y-2 max-h-48 overflow-y-auto">
                  {OBJECTION_HANDLERS[selectedObjectionCategory].map((item, idx) => (
                    <div key={idx} className="bg-slate-700/50 rounded-lg p-3">
                      <p className="text-sm text-red-400 font-medium mb-1">
                        "{item.objection}"
                      </p>
                      <p className="text-sm text-slate-300">
                        {item.response}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Mode Toggle */}
            <div className="flex items-center justify-between">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="bg-slate-800 border border-slate-700">
                  <TabsTrigger value="customer" className="data-[state=active]:bg-emerald-600">
                    <User className="w-4 h-4 mr-2" />
                    Customer
                  </TabsTrigger>
                  <TabsTrigger value="service" className="data-[state=active]:bg-emerald-600">
                    <Sparkles className="w-4 h-4 mr-2" />
                    Service
                  </TabsTrigger>
                  <TabsTrigger value="schedule" className="data-[state=active]:bg-emerald-600">
                    <Calendar className="w-4 h-4 mr-2" />
                    Schedule
                  </TabsTrigger>
                  <TabsTrigger value="sales" className="data-[state=active]:bg-emerald-600">
                    <DollarSign className="w-4 h-4 mr-2" />
                    Sales
                  </TabsTrigger>
                  <TabsTrigger value="close" className="data-[state=active]:bg-emerald-600">
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Close
                  </TabsTrigger>
                </TabsList>

                {/* Customer Tab */}
                <TabsContent value="customer" className="space-y-4 mt-4">
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-white flex items-center gap-2">
                          <User className="w-5 h-5 text-emerald-500" />
                          Customer Information
                        </CardTitle>
                        <Select value={leadSource} onValueChange={setLeadSource}>
                          <SelectTrigger className="w-48 bg-slate-700 border-slate-600 text-white">
                            <SelectValue placeholder="Lead Source" />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-800 border-slate-700">
                            {LEAD_SOURCES.map(source => (
                              <SelectItem key={source.value} value={source.value} className="text-white hover:bg-slate-700">
                                <div className="flex items-center gap-2">
                                  <source.icon className="w-4 h-4" />
                                  {source.label}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-slate-300">First Name *</Label>
                          <Input
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            placeholder="John"
                            className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-300">Last Name</Label>
                          <Input
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            placeholder="Smith"
                            className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-slate-300">Phone *</Label>
                          <Input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="(555) 123-4567"
                            className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-300">Email</Label>
                          <Input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="john@example.com"
                            className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                          />
                        </div>
                      </div>

                      {/* Customer Recognition */}
                      {checkingCustomer && (
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Checking customer status...
                        </div>
                      )}
                      {customerStatus && (
                        <CustomerRecognitionCard status={customerStatus} />
                      )}
                    </CardContent>
                  </Card>

                  {/* Address Card */}
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-white flex items-center gap-2">
                        <MapPin className="w-5 h-5 text-emerald-500" />
                        Service Address
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <AddressAutocomplete
                        onAddressSelect={handleAddressSelect}
                        initialValue={street}
                      />
                      
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label className="text-slate-300">City</Label>
                          <Input
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            placeholder="Baltimore"
                            className="bg-slate-700/50 border-slate-600 text-slate-300"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-300">State</Label>
                          <Input
                            value={state}
                            readOnly
                            className="bg-slate-700/50 border-slate-600 text-slate-300"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-300">ZIP Code</Label>
                          <Input
                            value={zipCode}
                            onChange={(e) => setZipCode(e.target.value)}
                            placeholder="21201"
                            maxLength={5}
                            className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-4">
                        <div className="space-y-2">
                          <Label className="text-slate-300">Bedrooms</Label>
                          <Select value={bedrooms} onValueChange={setBedrooms}>
                            <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-slate-700">
                              {[1, 2, 3, 4, 5, 6, 7].map(n => (
                                <SelectItem key={n} value={n.toString()} className="text-white">{n}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-300">Bathrooms</Label>
                          <Select value={bathrooms} onValueChange={setBathrooms}>
                            <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-slate-700">
                              {["1", "1.5", "2", "2.5", "3", "3.5", "4"].map(n => (
                                <SelectItem key={n} value={n} className="text-white">{n}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-300">Dwelling</Label>
                          <Select value={dwellingType} onValueChange={setDwellingType}>
                            <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                              <SelectValue placeholder="Type" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-slate-700">
                              <SelectItem value="house" className="text-white">House</SelectItem>
                              <SelectItem value="apartment" className="text-white">Apartment</SelectItem>
                              <SelectItem value="condo" className="text-white">Condo</SelectItem>
                              <SelectItem value="townhouse" className="text-white">Townhouse</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-300">Pets</Label>
                          <Select value={pets} onValueChange={setPets}>
                            <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-slate-700">
                              <SelectItem value="None" className="text-white">None</SelectItem>
                              <SelectItem value="Dog(s)" className="text-white">Dog(s)</SelectItem>
                              <SelectItem value="Cat(s)" className="text-white">Cat(s)</SelectItem>
                              <SelectItem value="Multiple" className="text-white">Multiple</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Service Tab */}
                <TabsContent value="service" className="space-y-4 mt-4">
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-white flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-emerald-500" />
                        Service Details
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Home Size Selection - Visual Grid */}
                      <div className="space-y-2">
                        <Label className="text-slate-300">Home Size *</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {HOME_SIZE_RANGES.filter(size => size.id !== '5000_plus').map((size) => (
                            <button
                              key={size.id}
                              onClick={() => setHomeSizeId(size.id)}
                              className={cn(
                                "p-3 rounded-lg border text-left transition-all",
                                homeSizeId === size.id
                                  ? "border-emerald-500 bg-emerald-500/20 text-white"
                                  : "border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500"
                              )}
                            >
                              <p className="font-semibold text-sm">{size.label}</p>
                              <p className="text-xs text-slate-400">{size.bedroomRange}</p>
                              <p className="text-xs text-emerald-400 mt-1">{size.baseHours}h • ${size.standardPrice}</p>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Service Type */}
                      <div className="space-y-2">
                        <Label className="text-slate-300">Service Type *</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {Object.entries(SERVICE_TIER_PRICING).map(([key, tier]) => (
                            <button
                              key={key}
                              onClick={() => setServiceType(key)}
                              className={cn(
                                "p-3 rounded-lg border text-left transition-all",
                                serviceType === key
                                  ? "border-emerald-500 bg-emerald-500/20 text-white"
                                  : "border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500"
                              )}
                            >
                              <p className="font-semibold">{tier.label}</p>
                              {tier.addition > 0 && (
                                <p className="text-xs text-emerald-400">+${tier.addition}</p>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Add-ons */}
                      <div className="space-y-2">
                        <Label className="text-slate-300">Add-ons (Upsell Opportunities)</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {Object.entries(ADD_ONS).map(([key, addon]) => (
                            <button
                              key={key}
                              onClick={() => handleAddOnToggle(key)}
                              className={cn(
                                "p-3 rounded-lg border text-left transition-all flex items-center justify-between",
                                addOns.includes(key)
                                  ? "border-emerald-500 bg-emerald-500/20 text-white"
                                  : "border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500"
                              )}
                            >
                              <div>
                                <p className="font-semibold text-sm">{addon.label}</p>
                                <p className="text-xs text-emerald-400">+${addon.price}</p>
                              </div>
                              {addOns.includes(key) && <CheckCircle className="w-5 h-5 text-emerald-500" />}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Frequency */}
                      <div className="space-y-2">
                        <Label className="text-slate-300">Frequency</Label>
                        <Select value={frequency} onValueChange={setFrequency}>
                          <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-800 border-slate-700">
                            <SelectItem value="One-Time" className="text-white">One-Time</SelectItem>
                            <SelectItem value="Weekly" className="text-white">Weekly (Best Value)</SelectItem>
                            <SelectItem value="Biweekly" className="text-white">Biweekly</SelectItem>
                            <SelectItem value="Monthly" className="text-white">Monthly</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Schedule Tab */}
                <TabsContent value="schedule" className="space-y-4 mt-4">
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-white flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-emerald-500" />
                        Scheduling
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-slate-300">Service Date</Label>
                          <Input
                            type="date"
                            value={serviceDate}
                            onChange={(e) => setServiceDate(e.target.value)}
                            min={new Date().toISOString().split('T')[0]}
                            className="bg-slate-700 border-slate-600 text-white"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-300">Time Slot</Label>
                          <Select value={timeSlot} onValueChange={setTimeSlot}>
                            <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                              <SelectValue placeholder="Select time" />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-800 border-slate-700">
                              <SelectItem value="8:00 AM - 12:00 PM" className="text-white">8:00 AM - 12:00 PM</SelectItem>
                              <SelectItem value="12:00 PM - 4:00 PM" className="text-white">12:00 PM - 4:00 PM</SelectItem>
                              <SelectItem value="4:00 PM - 8:00 PM" className="text-white">4:00 PM - 8:00 PM</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Switch
                          checked={flexibleSchedule}
                          onCheckedChange={setFlexibleSchedule}
                        />
                        <Label className="text-slate-300">Customer has flexible schedule</Label>
                      </div>

                      {homeSizeId && (
                        <div className="bg-slate-700/50 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-300">Estimated Duration</span>
                            <span className="text-white font-semibold">{estimatedDuration || "--"} hours</span>
                          </div>
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label className="text-slate-300">Access Notes</Label>
                        <Textarea
                          value={accessNotes}
                          onChange={(e) => setAccessNotes(e.target.value)}
                          placeholder="Gate codes, key locations, parking instructions..."
                          className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                          rows={3}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Cleaner Assignment */}
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-white flex items-center gap-2">
                        <Users className="w-5 h-5 text-emerald-500" />
                        Cleaner Assignment (Optional)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CleanerMultiSelect
                        cleaners={cleaners}
                        selectedCleaners={selectedCleaners}
                        onSelectionChange={setSelectedCleaners}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Sales Tab */}
                <TabsContent value="sales" className="space-y-4 mt-4">
                  {/* Payment Options */}
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-white flex items-center gap-2">
                        <CreditCard className="w-5 h-5 text-emerald-500" />
                        Payment Configuration
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Payment Option Toggle */}
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          onClick={() => setPaymentOption("deposit")}
                          className={cn(
                            "p-4 rounded-lg border text-left transition-all",
                            paymentOption === "deposit"
                              ? "border-emerald-500 bg-emerald-500/20"
                              : "border-slate-600 bg-slate-700/50 hover:border-slate-500"
                          )}
                        >
                          <p className="font-semibold text-white">Deposit Payment</p>
                          <p className="text-2xl font-bold text-emerald-400 mt-1">
                            ${DEPOSIT_AMOUNT}
                          </p>
                          <p className="text-xs text-slate-400 mt-1">Balance due after service</p>
                        </button>
                        <button
                          onClick={() => setPaymentOption("full")}
                          className={cn(
                            "p-4 rounded-lg border text-left transition-all relative overflow-hidden",
                            paymentOption === "full"
                              ? "border-emerald-500 bg-emerald-500/20"
                              : "border-slate-600 bg-slate-700/50 hover:border-slate-500"
                          )}
                        >
                          <Badge className="absolute top-2 right-2 bg-yellow-500/20 text-yellow-400 border-0">
                            10% OFF
                          </Badge>
                          <p className="font-semibold text-white">Pay In Full</p>
                          <p className="text-2xl font-bold text-emerald-400 mt-1">
                            ${('finalAmount' in pricing ? pricing.finalAmount : pricing.total).toFixed(2)}
                          </p>
                          <p className="text-xs text-slate-400 mt-1">Save with full payment</p>
                        </button>
                      </div>

                      {/* Payment Method */}
                      <div className="space-y-2">
                        <Label className="text-slate-300">Payment Method</Label>
                        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                          <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-800 border-slate-700">
                            <SelectItem value="Card" className="text-white">Credit/Debit Card</SelectItem>
                            <SelectItem value="Cash" className="text-white">Cash (on arrival)</SelectItem>
                            <SelectItem value="ACH" className="text-white">ACH Transfer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Discounts & Promos */}
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-white flex items-center gap-2">
                        <Tag className="w-5 h-5 text-emerald-500" />
                        Discounts & Promotions
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* New Customer Discount */}
                      {customerStatus?.isNew && (
                        <div className="flex items-center justify-between p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
                          <div className="flex items-center gap-3">
                            <Gift className="w-5 h-5 text-emerald-500" />
                            <div>
                              <p className="font-semibold text-white">New Customer Discount</p>
                              <p className="text-xs text-slate-400">First-time customer special</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-emerald-400 font-bold">-${NEW_CUSTOMER_DISCOUNT}</span>
                            <Switch
                              checked={applyNewCustomerDiscount}
                              onCheckedChange={setApplyNewCustomerDiscount}
                            />
                          </div>
                        </div>
                      )}

                      {/* Custom Discount */}
                      <Collapsible>
                        <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors">
                          <div className="flex items-center gap-3">
                            <Percent className="w-5 h-5 text-yellow-500" />
                            <span className="font-semibold text-white">Custom Discount</span>
                          </div>
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={customDiscountEnabled}
                              onCheckedChange={setCustomDiscountEnabled}
                            />
                            <Label className="text-slate-300">Enable custom discount</Label>
                          </div>
                          {customDiscountEnabled && (
                            <>
                              <div className="grid grid-cols-2 gap-3">
                                <Select value={customDiscountType} onValueChange={(v: "percent" | "amount") => setCustomDiscountType(v)}>
                                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="bg-slate-800 border-slate-700">
                                    <SelectItem value="amount" className="text-white">$ Amount</SelectItem>
                                    <SelectItem value="percent" className="text-white">% Percent</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Input
                                  type="number"
                                  value={customDiscountValue}
                                  onChange={(e) => setCustomDiscountValue(Number(e.target.value))}
                                  placeholder="0"
                                  className="bg-slate-700 border-slate-600 text-white"
                                />
                              </div>
                              <Input
                                value={discountReason}
                                onChange={(e) => setDiscountReason(e.target.value)}
                                placeholder="Reason for discount (required for audit)"
                                className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                              />
                            </>
                          )}
                        </CollapsibleContent>
                      </Collapsible>

                      {/* Promo Code */}
                      <div className="flex gap-2">
                        <Input
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                          placeholder="Promo code"
                          className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                        />
                        <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700">
                          Apply
                        </Button>
                      </div>

                      {/* Referral Code */}
                      <div className="flex gap-2">
                        <Input
                          value={referralCode}
                          onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                          placeholder="Referral code"
                          className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                        />
                        <Button variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-700">
                          Apply
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Membership Upsell */}
                  <Card className="bg-gradient-to-br from-purple-900/30 to-slate-800/50 border-purple-700/50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-white flex items-center gap-2">
                        <Star className="w-5 h-5 text-purple-400" />
                        Membership Upsell
                      </CardTitle>
                      <CardDescription className="text-purple-300">
                        Offer recurring service for better value
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-3">
                        {Object.entries(MEMBERSHIP_PLANS).filter(([key]) => key !== 'none').map(([key, plan]) => (
                          <button
                            key={key}
                            onClick={() => setMembershipPlan(key)}
                            className={cn(
                              "p-3 rounded-lg border text-left transition-all",
                              membershipPlan === key
                                ? "border-purple-500 bg-purple-500/20"
                                : "border-slate-600 bg-slate-700/30 hover:border-slate-500"
                            )}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-white">{plan.label}</span>
                              <Badge className="bg-purple-500/30 text-purple-300 border-0 text-xs">
                                {(plan.discount * 100)}% off
                              </Badge>
                            </div>
                            <p className="text-lg font-bold text-purple-400">${plan.monthlyPrice}/mo</p>
                            <p className="text-xs text-slate-400 mt-1">{plan.description}</p>
                          </button>
                        ))}
                      </div>
                      {membershipPlan !== 'none' && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setMembershipPlan('none')}
                          className="mt-3 text-slate-400 hover:text-white"
                        >
                          Remove membership
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Close Tab */}
                <TabsContent value="close" className="space-y-4 mt-4">
                  {/* Call Outcome */}
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-white flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-emerald-500" />
                        Call Outcome
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-2">
                        {CALL_OUTCOMES.map((outcome) => (
                          <button
                            key={outcome.value}
                            onClick={() => setCallOutcome(outcome.value)}
                            className={cn(
                              "p-3 rounded-lg border text-left transition-all",
                              callOutcome === outcome.value
                                ? "border-emerald-500 bg-emerald-500/20"
                                : "border-slate-600 bg-slate-700/50 hover:border-slate-500"
                            )}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <div className={cn("w-2 h-2 rounded-full", outcome.color)} />
                              <span className="font-semibold text-white text-sm">{outcome.label}</span>
                            </div>
                            <p className="text-xs text-slate-400">{outcome.description}</p>
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Follow-up Scheduling */}
                  {(callOutcome === "follow_up" || callOutcome === "quote_sent" || callOutcome === "price_objection") && (
                    <Card className="bg-slate-800/50 border-slate-700">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-white flex items-center gap-2">
                          <Calendar className="w-5 h-5 text-yellow-500" />
                          Schedule Follow-up
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-slate-300">Follow-up Date</Label>
                            <Input
                              type="date"
                              value={followUpDate}
                              onChange={(e) => setFollowUpDate(e.target.value)}
                              min={new Date().toISOString().split('T')[0]}
                              className="bg-slate-700 border-slate-600 text-white"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-slate-300">Follow-up Time</Label>
                            <Input
                              type="time"
                              value={followUpTime}
                              onChange={(e) => setFollowUpTime(e.target.value)}
                              className="bg-slate-700 border-slate-600 text-white"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-slate-300">Follow-up Notes</Label>
                          <Textarea
                            value={followUpNotes}
                            onChange={(e) => setFollowUpNotes(e.target.value)}
                            placeholder="What to discuss on the follow-up call..."
                            className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                            rows={2}
                          />
                        </div>
                        <Button 
                          onClick={handleSaveFollowUp}
                          className="w-full bg-yellow-600 hover:bg-yellow-700"
                        >
                          <Calendar className="w-4 h-4 mr-2" />
                          Save Follow-up & End Call
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  {/* Call Notes */}
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-white flex items-center gap-2">
                        <FileText className="w-5 h-5 text-emerald-500" />
                        Call Notes
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        value={callNotes}
                        onChange={(e) => setCallNotes(e.target.value)}
                        placeholder="Important details from the call..."
                        className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500"
                        rows={4}
                      />
                    </CardContent>
                  </Card>

                  {/* Generate Payment Link */}
                  {callOutcome === "booked" && (
                    <Card className="bg-gradient-to-br from-emerald-900/30 to-slate-800/50 border-emerald-700/50">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-white flex items-center gap-2">
                          <Send className="w-5 h-5 text-emerald-400" />
                          Send Payment Link
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {!paymentLinkGenerated ? (
                          <Button 
                            onClick={generatePaymentLink}
                            className="w-full bg-gradient-to-r from-emerald-500 to-teal-600"
                          >
                            <Zap className="w-4 h-4 mr-2" />
                            Generate Payment Link (${displayAmount.toFixed(2)})
                          </Button>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <Input
                                value={paymentLink}
                                readOnly
                                className="bg-slate-700 border-slate-600 text-white font-mono text-xs"
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => navigator.clipboard.writeText(paymentLink)}
                                className="border-slate-600 text-slate-300"
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => window.open(paymentLink, '_blank')}
                                className="border-slate-600 text-slate-300"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </Button>
                            </div>
                            <div className="flex gap-2">
                              <Button className="flex-1 bg-blue-600 hover:bg-blue-700">
                                <MessageSquare className="w-4 h-4 mr-2" />
                                Send via SMS
                              </Button>
                              <Button className="flex-1 bg-slate-600 hover:bg-slate-700">
                                <Send className="w-4 h-4 mr-2" />
                                Send via Email
                              </Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Final Action Buttons */}
                  <div className="grid grid-cols-2 gap-4">
                    <Button
                      variant="outline"
                      onClick={clearForm}
                      className="border-slate-600 text-slate-300 hover:bg-slate-700"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Clear & New Call
                    </Button>
                    <Button
                      onClick={handleQuickBook}
                      disabled={loading || !homeSizeId}
                      className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
                    >
                      {loading ? (
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4 mr-2" />
                      )}
                      Create Booking
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>

          {/* Right Column - Live Pricing & Quick Stats */}
          <div className="space-y-4">
            {/* Live Pricing Card */}
            <Card className="bg-slate-800/50 border-slate-700 sticky top-24">
              <CardHeader className="pb-3">
                <CardTitle className="text-white flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-emerald-500" />
                  Live Pricing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {homeSizeId ? (
                  <>
                    {/* Price Breakdown */}
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between text-slate-400">
                        <span>Base Price</span>
                        <span className="text-white">
                          ${('basePrice' in pricing ? pricing.basePrice : pricing.originalTotal).toFixed(2)}
                        </span>
                      </div>
                      {'serviceAddition' in pricing && pricing.serviceAddition > 0 && (
                        <div className="flex justify-between text-slate-400">
                          <span>Service Tier</span>
                          <span className="text-white">+${pricing.serviceAddition.toFixed(2)}</span>
                        </div>
                      )}
                      {'addOnsTotal' in pricing && pricing.addOnsTotal > 0 && (
                        <div className="flex justify-between text-slate-400">
                          <span>Add-ons</span>
                          <span className="text-white">+${pricing.addOnsTotal.toFixed(2)}</span>
                        </div>
                      )}
                      
                      <Separator className="bg-slate-700" />
                      
                      <div className="flex justify-between text-slate-400">
                        <span>Subtotal</span>
                        <span className="text-white">
                          ${('subtotal' in pricing ? pricing.subtotal : pricing.originalTotal).toFixed(2)}
                        </span>
                      </div>

                      {/* Discounts */}
                      {applyNewCustomerDiscount && customerStatus?.isNew && (
                        <div className="flex justify-between text-emerald-400">
                          <span>New Customer Discount</span>
                          <span>-${NEW_CUSTOMER_DISCOUNT.toFixed(2)}</span>
                        </div>
                      )}
                      {'membershipDiscount' in pricing && pricing.membershipDiscount > 0 && (
                        <div className="flex justify-between text-purple-400">
                          <span>Membership Discount</span>
                          <span>-${pricing.membershipDiscount.toFixed(2)}</span>
                        </div>
                      )}
                      {paymentOption === "full" && 'discount' in pricing && (
                        <div className="flex justify-between text-yellow-400">
                          <span>Pay In Full Discount</span>
                          <span>-${pricing.discount.toFixed(2)}</span>
                        </div>
                      )}
                      {customDiscountEnabled && customDiscountValue > 0 && (
                        <div className="flex justify-between text-orange-400">
                          <span>Custom Discount</span>
                          <span>
                            -{customDiscountType === "percent" ? `${customDiscountValue}%` : `$${customDiscountValue}`}
                          </span>
                        </div>
                      )}
                    </div>

                    <Separator className="bg-slate-700" />

                    {/* Total */}
                    <div className="space-y-2">
                      {paymentOption === "deposit" ? (
                        <>
                          <div className="flex justify-between">
                            <span className="font-semibold text-white">Deposit Due Now</span>
                            <span className="text-2xl font-bold text-emerald-400">
                              ${DEPOSIT_AMOUNT}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm text-slate-400">
                            <span>Balance After Service</span>
                            <span className="text-white">
                              ${('balanceDue' in pricing ? pricing.balanceDue : 0).toFixed(2)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="flex justify-between">
                          <span className="font-semibold text-white">Total Due Now</span>
                          <span className="text-2xl font-bold text-emerald-400">
                            ${('finalAmount' in pricing ? pricing.finalAmount : pricing.total).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Urgency Prompts */}
                    <div className="space-y-2 pt-2">
                      <p className="text-xs text-slate-400 uppercase tracking-wider">Value Highlights</p>
                      {URGENCY_OFFERS.map((offer) => (
                        <div key={offer.id} className="flex items-start gap-2 text-xs">
                          <CheckCircle className="w-3 h-3 text-emerald-500 mt-0.5 flex-shrink-0" />
                          <span className="text-slate-300">{offer.description}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Select a home size to see pricing</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Script Prompts */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-white flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-emerald-500" />
                  Quick Scripts
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <button className="w-full text-left p-2 rounded bg-slate-700/50 hover:bg-slate-700 transition-colors">
                  <p className="text-xs font-semibold text-white">Opening</p>
                  <p className="text-xs text-slate-400">"Hi! Thanks for calling Novara. How can I help you today?"</p>
                </button>
                <button className="w-full text-left p-2 rounded bg-slate-700/50 hover:bg-slate-700 transition-colors">
                  <p className="text-xs font-semibold text-white">Pricing Intro</p>
                  <p className="text-xs text-slate-400">"Our pricing is based on home size. What's the square footage?"</p>
                </button>
                <button className="w-full text-left p-2 rounded bg-slate-700/50 hover:bg-slate-700 transition-colors">
                  <p className="text-xs font-semibold text-white">Close</p>
                  <p className="text-xs text-slate-400">"I have an opening on [DATE]. Can I get you booked?"</p>
                </button>
                <button className="w-full text-left p-2 rounded bg-slate-700/50 hover:bg-slate-700 transition-colors">
                  <p className="text-xs font-semibold text-white">Value Prop</p>
                  <p className="text-xs text-slate-400">"We're Google Guaranteed and all cleaners are background-checked."</p>
                </button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
