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
  ThumbsUp, ThumbsDown, BarChart3, Lightbulb, Crown
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

// Admin credentials
const ADMIN_EMAIL = "contact@novaracleaning.com";
const ADMIN_PASSWORD = "Divine74!";

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

  // Authentication
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginMode, setLoginMode] = useState<"pin" | "email">("email");
  const [pinCode, setPinCode] = useState(["", "", "", ""]);
  const [pinError, setPinError] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  // Call Timer
  const [callStartTime, setCallStartTime] = useState<Date | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isCallActive, setIsCallActive] = useState(false);

  // Sales Mode
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

  // Section 6: Notes
  const [accessNotes, setAccessNotes] = useState("");
  const [callNotes, setCallNotes] = useState("");

  // UI State
  const [showObjectionHelper, setShowObjectionHelper] = useState(false);
  const [selectedObjectionCategory, setSelectedObjectionCategory] = useState<string | null>(null);
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
    
    if (firstName) score += 5;
    if (lastName) score += 5;
    if (email && email.includes('@')) score += 8;
    if (phone && phone.length >= 10) score += 7;
    
    if (homeSizeId) score += 10;
    if (serviceType !== 'standard') score += 5;
    if (serviceDate) score += 15;
    
    if (customerStatus?.isNew === false) score += 10;
    if (customerStatus?.hasMembership) score += 15;
    if (leadSource === 'referral') score += 10;
    if (leadSource === 'google_lsa') score += 8;
    
    if (serviceDate) {
      const daysUntilService = Math.ceil((new Date(serviceDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysUntilService <= 3) score += 20;
      else if (daysUntilService <= 7) score += 15;
      else if (daysUntilService <= 14) score += 10;
    }
    
    setLeadScore(Math.min(100, score));
    
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
        setCustomerStatus({ isNew: false, hasMembership: false });
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

    updated.sort((a, b) => (a.distance || 9999) - (b.distance || 9999));
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

  const handleEmailLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    
    const emailMatch = adminEmail.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const passwordMatch = adminPassword === ADMIN_PASSWORD;
    
    if (emailMatch && passwordMatch) {
      sessionStorage.setItem("va_sales_access", "true");
      setIsAuthenticated(true);
      startCall();
    } else {
      setLoginError("Invalid email or password. Please try again.");
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
    return discount;
  };

  const getPricing = () => {
    const totalDiscount = calculateTotalDiscount();
    const isNewCustomer = customerStatus?.isNew ?? true;
    
    if (paymentOption === "full") {
      return calculateFullPaymentWithDiscount(
        homeSizeId, serviceType, addOns, membershipPlan, false, 
        isNewCustomer && applyNewCustomerDiscount,
        totalDiscount - (applyNewCustomerDiscount && isNewCustomer ? NEW_CUSTOMER_DISCOUNT : 0)
      );
    }
    
    return calculatePrice(
      homeSizeId, serviceType, addOns, membershipPlan, false, 
      isNewCustomer && applyNewCustomerDiscount,
      totalDiscount - (applyNewCustomerDiscount && isNewCustomer ? NEW_CUSTOMER_DISCOUNT : 0)
    );
  };

  const generatePaymentLink = async () => {
    const pricing = getPricing();
    const amount = paymentOption === "full" 
      ? ('finalAmount' in pricing ? pricing.finalAmount : pricing.total)
      : pricing.deposit;
    
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
        description: `Booking #${booking.id.slice(-6)} created successfully.`,
      });

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

  // Login Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-card border-primary/20">
          <CardContent className="pt-8 pb-8">
            <div className="flex flex-col items-center space-y-6">
              <div className="w-20 h-20 rounded-full bg-gradient-primary flex items-center justify-center shadow-lg">
                <Headphones className="w-10 h-10 text-white" />
              </div>
              
              <div className="text-center">
                <h1 className="text-2xl font-bold text-foreground mb-2 font-jakarta">
                  Novara VA Sales Portal
                </h1>
                <p className="text-sm text-muted-foreground">
                  Sign in to begin taking calls
                </p>
              </div>

              {/* Login Mode Toggle */}
              <div className="flex gap-2 w-full">
                <Button
                  variant={loginMode === "email" ? "default" : "outline"}
                  onClick={() => setLoginMode("email")}
                  className={cn("flex-1", loginMode === "email" && "bg-gradient-primary")}
                >
                  <User className="w-4 h-4 mr-2" />
                  Admin Login
                </Button>
                <Button
                  variant={loginMode === "pin" ? "default" : "outline"}
                  onClick={() => setLoginMode("pin")}
                  className={cn("flex-1", loginMode === "pin" && "bg-gradient-primary")}
                >
                  <Lock className="w-4 h-4 mr-2" />
                  PIN Code
                </Button>
              </div>

              {loginMode === "email" ? (
                <form onSubmit={handleEmailLogin} className="w-full space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="admin-email">Email</Label>
                    <Input
                      id="admin-email"
                      type="email"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="contact@novaracleaning.com"
                      className="h-12"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="admin-password">Password</Label>
                    <Input
                      id="admin-password"
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="Enter password"
                      className="h-12"
                    />
                  </div>

                  {loginError && (
                    <p className="text-sm text-destructive flex items-center gap-2">
                      <XCircle className="w-4 h-4" />
                      {loginError}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={!adminEmail || !adminPassword}
                    className="w-full bg-gradient-primary font-semibold"
                    size="lg"
                  >
                    <Phone className="w-5 h-5 mr-2" />
                    Sign In & Start Calls
                  </Button>
                </form>
              ) : (
                <>
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
                        className="w-14 h-14 text-center text-2xl font-bold border-2 focus:border-primary"
                        autoFocus={index === 0}
                      />
                    ))}
                  </div>

                  {pinError && (
                    <p className="text-sm text-destructive flex items-center gap-2">
                      <XCircle className="w-4 h-4" />
                      Incorrect PIN. Please try again.
                    </p>
                  )}

                  <Button
                    onClick={handlePinSubmit}
                    disabled={!pinCode.every(d => d)}
                    className="w-full bg-gradient-primary font-semibold"
                    size="lg"
                  >
                    <Phone className="w-5 h-5 mr-2" />
                    Start Taking Calls
                  </Button>
                </>
              )}
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
    <div className="min-h-screen bg-gradient-hero">
      {/* Sticky Header */}
      <div className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur-sm shadow-sm">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => navigate("/admin/dispatch")}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="text-xl font-bold text-foreground flex items-center gap-2 font-jakarta">
                  <Headphones className="w-5 h-5 text-primary" />
                  VA Sales Portal
                </h1>
                <p className="text-xs text-muted-foreground">Novara Phone Sales</p>
              </div>
            </div>

            {/* Call Timer & Lead Score */}
            <div className="flex items-center gap-4">
              {/* Call Timer */}
              <div className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full border",
                isCallActive 
                  ? "bg-green-50 border-green-200 text-green-700" 
                  : "bg-muted border-border text-muted-foreground"
              )}>
                <Timer className="w-4 h-4" />
                <span className="font-mono font-bold">{formatCallDuration(callDuration)}</span>
                {isCallActive ? (
                  <Button size="sm" variant="ghost" onClick={endCall} className="h-6 px-2 text-red-600 hover:text-red-700 hover:bg-red-50">
                    End
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={startCall} className="h-6 px-2 text-green-600 hover:text-green-700 hover:bg-green-50">
                    Start
                  </Button>
                )}
              </div>

              {/* Lead Score */}
              <div className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full border",
                leadTemperature === "hot" && "bg-red-50 border-red-200 text-red-700",
                leadTemperature === "warm" && "bg-yellow-50 border-yellow-200 text-yellow-700",
                leadTemperature === "cold" && "bg-blue-50 border-blue-200 text-blue-700"
              )}>
                <Target className="w-4 h-4" />
                <span className="font-bold">{leadScore}%</span>
                <Badge variant="secondary" className={cn(
                  "text-xs",
                  leadTemperature === "hot" && "bg-red-100 text-red-700",
                  leadTemperature === "warm" && "bg-yellow-100 text-yellow-700",
                  leadTemperature === "cold" && "bg-blue-100 text-blue-700"
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
                >
                  <Lightbulb className="w-4 h-4 mr-1" />
                  Objections
                </Button>
                <Button
                  onClick={handleQuickBook}
                  disabled={loading || !homeSizeId}
                  className="bg-gradient-primary"
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
        <div className="border-b bg-accent/30">
          <div className="container mx-auto px-4 py-4">
            <div className="flex gap-4">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Select Objection Type</p>
                <div className="flex gap-2">
                  {Object.keys(OBJECTION_HANDLERS).map(category => (
                    <Button
                      key={category}
                      size="sm"
                      variant={selectedObjectionCategory === category ? "default" : "outline"}
                      onClick={() => setSelectedObjectionCategory(category)}
                      className={selectedObjectionCategory === category ? "bg-gradient-primary" : ""}
                    >
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
              {selectedObjectionCategory && (
                <div className="flex-1 space-y-2 max-h-48 overflow-y-auto">
                  {OBJECTION_HANDLERS[selectedObjectionCategory].map((item, idx) => (
                    <div key={idx} className="bg-card rounded-lg p-3 border shadow-sm">
                      <p className="text-sm text-destructive font-medium mb-1">
                        "{item.objection}"
                      </p>
                      <p className="text-sm text-foreground">
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
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="customer" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-white">
                  <User className="w-4 h-4 mr-2" />
                  Customer
                </TabsTrigger>
                <TabsTrigger value="service" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-white">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Service
                </TabsTrigger>
                <TabsTrigger value="schedule" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-white">
                  <Calendar className="w-4 h-4 mr-2" />
                  Schedule
                </TabsTrigger>
                <TabsTrigger value="sales" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-white">
                  <DollarSign className="w-4 h-4 mr-2" />
                  Sales
                </TabsTrigger>
                <TabsTrigger value="close" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-white">
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Close
                </TabsTrigger>
              </TabsList>

              {/* Customer Tab */}
              <TabsContent value="customer" className="space-y-4 mt-4">
                <Card className="shadow-card border-border/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <User className="w-5 h-5 text-primary" />
                        Customer Information
                      </CardTitle>
                      <Select value={leadSource} onValueChange={setLeadSource}>
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder="Lead Source" />
                        </SelectTrigger>
                        <SelectContent>
                          {LEAD_SOURCES.map(source => (
                            <SelectItem key={source.value} value={source.value}>
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
                        <Label>First Name *</Label>
                        <Input
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          placeholder="John"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Last Name</Label>
                        <Input
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          placeholder="Smith"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Phone *</Label>
                        <Input
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="(555) 123-4567"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="john@example.com"
                        />
                      </div>
                    </div>

                    {checkingCustomer && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Checking customer status...
                      </div>
                    )}
                    {customerStatus && (
                      <CustomerRecognitionCard status={customerStatus} />
                    )}
                  </CardContent>
                </Card>

                <Card className="shadow-card border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-primary" />
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
                        <Label>City</Label>
                        <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Baltimore" />
                      </div>
                      <div className="space-y-2">
                        <Label>State</Label>
                        <Input value={state} readOnly className="bg-muted" />
                      </div>
                      <div className="space-y-2">
                        <Label>ZIP Code</Label>
                        <Input value={zipCode} onChange={(e) => setZipCode(e.target.value)} placeholder="21201" maxLength={5} />
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label>Bedrooms</Label>
                        <Select value={bedrooms} onValueChange={setBedrooms}>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5, 6, 7].map(n => (
                              <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Bathrooms</Label>
                        <Select value={bathrooms} onValueChange={setBathrooms}>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            {["1", "1.5", "2", "2.5", "3", "3.5", "4"].map(n => (
                              <SelectItem key={n} value={n}>{n}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Dwelling</Label>
                        <Select value={dwellingType} onValueChange={setDwellingType}>
                          <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="house">House</SelectItem>
                            <SelectItem value="apartment">Apartment</SelectItem>
                            <SelectItem value="condo">Condo</SelectItem>
                            <SelectItem value="townhouse">Townhouse</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Pets</Label>
                        <Select value={pets} onValueChange={setPets}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="None">None</SelectItem>
                            <SelectItem value="Dog(s)">Dog(s)</SelectItem>
                            <SelectItem value="Cat(s)">Cat(s)</SelectItem>
                            <SelectItem value="Multiple">Multiple</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Service Tab */}
              <TabsContent value="service" className="space-y-4 mt-4">
                <Card className="shadow-card border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-primary" />
                      Service Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Home Size *</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {HOME_SIZE_RANGES.filter(size => size.id !== '5000_plus').map((size) => (
                          <button
                            key={size.id}
                            onClick={() => setHomeSizeId(size.id)}
                            className={cn(
                              "p-3 rounded-lg border-2 text-left transition-all",
                              homeSizeId === size.id
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-primary/50"
                            )}
                          >
                            <p className="font-semibold text-sm">{size.label}</p>
                            <p className="text-xs text-muted-foreground">{size.bedroomRange}</p>
                            <p className="text-xs text-primary mt-1">{size.baseHours}h - ${size.standardPrice}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Service Type *</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.entries(SERVICE_TIER_PRICING).map(([key, tier]) => (
                          <button
                            key={key}
                            onClick={() => setServiceType(key)}
                            className={cn(
                              "p-3 rounded-lg border-2 text-left transition-all",
                              serviceType === key
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-primary/50"
                            )}
                          >
                            <p className="font-semibold">{tier.label}</p>
                            {tier.addition > 0 && (
                              <p className="text-xs text-primary">+${tier.addition}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Add-ons (Upsell Opportunities)</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.entries(ADD_ONS).map(([key, addon]) => (
                          <button
                            key={key}
                            onClick={() => handleAddOnToggle(key)}
                            className={cn(
                              "p-3 rounded-lg border-2 text-left transition-all flex items-center justify-between",
                              addOns.includes(key)
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-primary/50"
                            )}
                          >
                            <div>
                              <p className="font-semibold text-sm">{addon.label}</p>
                              <p className="text-xs text-primary">+${addon.price}</p>
                            </div>
                            {addOns.includes(key) && <CheckCircle className="w-5 h-5 text-primary" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Frequency</Label>
                      <Select value={frequency} onValueChange={setFrequency}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="One-Time">One-Time</SelectItem>
                          <SelectItem value="Weekly">Weekly (Best Value)</SelectItem>
                          <SelectItem value="Biweekly">Biweekly</SelectItem>
                          <SelectItem value="Monthly">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Schedule Tab */}
              <TabsContent value="schedule" className="space-y-4 mt-4">
                <Card className="shadow-card border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-primary" />
                      Scheduling
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Service Date</Label>
                        <Input
                          type="date"
                          value={serviceDate}
                          onChange={(e) => setServiceDate(e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Time Slot</Label>
                        <Select value={timeSlot} onValueChange={setTimeSlot}>
                          <SelectTrigger><SelectValue placeholder="Select time" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="8:00 AM - 12:00 PM">8:00 AM - 12:00 PM</SelectItem>
                            <SelectItem value="12:00 PM - 4:00 PM">12:00 PM - 4:00 PM</SelectItem>
                            <SelectItem value="4:00 PM - 8:00 PM">4:00 PM - 8:00 PM</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Switch checked={flexibleSchedule} onCheckedChange={setFlexibleSchedule} />
                      <Label>Customer has flexible schedule</Label>
                    </div>

                    {homeSizeId && (
                      <div className="bg-accent/50 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Estimated Duration</span>
                          <span className="font-semibold">{estimatedDuration || "--"} hours</span>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>Access Notes</Label>
                      <Textarea
                        value={accessNotes}
                        onChange={(e) => setAccessNotes(e.target.value)}
                        placeholder="Gate codes, key locations, parking instructions..."
                        rows={3}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-card border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5 text-primary" />
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
                <Card className="shadow-card border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-primary" />
                      Payment Configuration
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setPaymentOption("deposit")}
                        className={cn(
                          "p-4 rounded-lg border-2 text-left transition-all",
                          paymentOption === "deposit"
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        <p className="font-semibold">Deposit Payment</p>
                        <p className="text-2xl font-bold text-primary mt-1">${DEPOSIT_AMOUNT}</p>
                        <p className="text-xs text-muted-foreground mt-1">Balance due after service</p>
                      </button>
                      <button
                        onClick={() => setPaymentOption("full")}
                        className={cn(
                          "p-4 rounded-lg border-2 text-left transition-all relative overflow-hidden",
                          paymentOption === "full"
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        <Badge className="absolute top-2 right-2 bg-gradient-primary text-white">10% OFF</Badge>
                        <p className="font-semibold">Pay In Full</p>
                        <p className="text-2xl font-bold text-primary mt-1">
                          ${('finalAmount' in pricing ? pricing.finalAmount : pricing.total).toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">Save with full payment</p>
                      </button>
                    </div>

                    <div className="space-y-2">
                      <Label>Payment Method</Label>
                      <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Card">Credit/Debit Card</SelectItem>
                          <SelectItem value="Cash">Cash (on arrival)</SelectItem>
                          <SelectItem value="ACH">ACH Transfer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-card border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                      <Tag className="w-5 h-5 text-primary" />
                      Discounts & Promotions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {customerStatus?.isNew && (
                      <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                        <div className="flex items-center gap-3">
                          <Gift className="w-5 h-5 text-green-600" />
                          <div>
                            <p className="font-semibold">New Customer Discount</p>
                            <p className="text-xs text-muted-foreground">First-time customer special</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-green-600 font-bold">-${NEW_CUSTOMER_DISCOUNT}</span>
                          <Switch checked={applyNewCustomerDiscount} onCheckedChange={setApplyNewCustomerDiscount} />
                        </div>
                      </div>
                    )}

                    <Collapsible>
                      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-accent/50 rounded-lg hover:bg-accent transition-colors">
                        <div className="flex items-center gap-3">
                          <Percent className="w-5 h-5 text-primary" />
                          <span className="font-semibold">Custom Discount</span>
                        </div>
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-4 space-y-3">
                        <div className="flex items-center gap-2">
                          <Switch checked={customDiscountEnabled} onCheckedChange={setCustomDiscountEnabled} />
                          <Label>Enable custom discount</Label>
                        </div>
                        {customDiscountEnabled && (
                          <>
                            <div className="grid grid-cols-2 gap-3">
                              <Select value={customDiscountType} onValueChange={(v: "percent" | "amount") => setCustomDiscountType(v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="amount">$ Amount</SelectItem>
                                  <SelectItem value="percent">% Percent</SelectItem>
                                </SelectContent>
                              </Select>
                              <Input
                                type="number"
                                value={customDiscountValue}
                                onChange={(e) => setCustomDiscountValue(Number(e.target.value))}
                                placeholder="0"
                              />
                            </div>
                            <Input
                              value={discountReason}
                              onChange={(e) => setDiscountReason(e.target.value)}
                              placeholder="Reason for discount (required for audit)"
                            />
                          </>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  </CardContent>
                </Card>

                <Card className="shadow-card border-primary/30 bg-gradient-to-br from-primary/5 to-accent/10">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                      <Crown className="w-5 h-5 text-primary" />
                      Membership Upsell
                    </CardTitle>
                    <CardDescription>Offer recurring service for better value</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(MEMBERSHIP_PLANS).filter(([key]) => key !== 'none').map(([key, plan]) => (
                        <button
                          key={key}
                          onClick={() => setMembershipPlan(key)}
                          className={cn(
                            "p-3 rounded-lg border-2 text-left transition-all",
                            membershipPlan === key
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-primary/50"
                          )}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold">{plan.label}</span>
                            <Badge className="bg-primary/20 text-primary border-0 text-xs">
                              {(plan.discount * 100)}% off
                            </Badge>
                          </div>
                          <p className="text-lg font-bold text-primary">${plan.monthlyPrice}/mo</p>
                          <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
                        </button>
                      ))}
                    </div>
                    {membershipPlan !== 'none' && (
                      <Button variant="ghost" size="sm" onClick={() => setMembershipPlan('none')} className="mt-3">
                        Remove membership
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Close Tab */}
              <TabsContent value="close" className="space-y-4 mt-4">
                <Card className="shadow-card border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-primary" />
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
                            "p-3 rounded-lg border-2 text-left transition-all",
                            callOutcome === outcome.value
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div className={cn("w-2 h-2 rounded-full", outcome.color)} />
                            <span className="font-semibold text-sm">{outcome.label}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{outcome.description}</p>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {(callOutcome === "follow_up" || callOutcome === "quote_sent" || callOutcome === "price_objection") && (
                  <Card className="shadow-card border-yellow-200 bg-yellow-50/50">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-yellow-600" />
                        Schedule Follow-up
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Follow-up Date</Label>
                          <Input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
                        </div>
                        <div className="space-y-2">
                          <Label>Follow-up Time</Label>
                          <Input type="time" value={followUpTime} onChange={(e) => setFollowUpTime(e.target.value)} />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Follow-up Notes</Label>
                        <Textarea value={followUpNotes} onChange={(e) => setFollowUpNotes(e.target.value)} placeholder="What to discuss on the follow-up call..." rows={2} />
                      </div>
                      <Button onClick={handleSaveFollowUp} className="w-full bg-yellow-600 hover:bg-yellow-700">
                        <Calendar className="w-4 h-4 mr-2" />
                        Save Follow-up & End Call
                      </Button>
                    </CardContent>
                  </Card>
                )}

                <Card className="shadow-card border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5 text-primary" />
                      Call Notes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={callNotes}
                      onChange={(e) => setCallNotes(e.target.value)}
                      placeholder="Important details from the call..."
                      rows={4}
                    />
                  </CardContent>
                </Card>

                {callOutcome === "booked" && (
                  <Card className="shadow-card border-green-200 bg-green-50/50">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2">
                        <Send className="w-5 h-5 text-green-600" />
                        Send Payment Link
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {!paymentLinkGenerated ? (
                        <Button onClick={generatePaymentLink} className="w-full bg-gradient-primary">
                          <Zap className="w-4 h-4 mr-2" />
                          Generate Payment Link (${displayAmount.toFixed(2)})
                        </Button>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Input value={paymentLink} readOnly className="font-mono text-xs" />
                            <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(paymentLink)}>
                              <Copy className="w-4 h-4" />
                            </Button>
                            <Button variant="outline" size="icon" onClick={() => window.open(paymentLink, '_blank')}>
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          </div>
                          <div className="flex gap-2">
                            <Button className="flex-1 bg-blue-600 hover:bg-blue-700">
                              <MessageSquare className="w-4 h-4 mr-2" />
                              Send via SMS
                            </Button>
                            <Button className="flex-1" variant="outline">
                              <Send className="w-4 h-4 mr-2" />
                              Send via Email
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <Button variant="outline" onClick={clearForm}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Clear & New Call
                  </Button>
                  <Button onClick={handleQuickBook} disabled={loading || !homeSizeId} className="bg-gradient-primary">
                    {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                    Create Booking
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Column - Live Pricing & Quick Stats */}
          <div className="space-y-4">
            <Card className="shadow-card border-primary/20 sticky top-24">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-primary" />
                  Live Pricing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {homeSizeId ? (
                  <>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Base Price</span>
                        <span className="font-medium">${('basePrice' in pricing ? pricing.basePrice : pricing.originalTotal).toFixed(2)}</span>
                      </div>
                      {'serviceAddition' in pricing && pricing.serviceAddition > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Service Tier</span>
                          <span className="font-medium">+${pricing.serviceAddition.toFixed(2)}</span>
                        </div>
                      )}
                      {'addOnsTotal' in pricing && pricing.addOnsTotal > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Add-ons</span>
                          <span className="font-medium">+${pricing.addOnsTotal.toFixed(2)}</span>
                        </div>
                      )}
                      
                      <Separator />
                      
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-medium">${('subtotal' in pricing ? pricing.subtotal : pricing.originalTotal).toFixed(2)}</span>
                      </div>

                      {applyNewCustomerDiscount && customerStatus?.isNew && (
                        <div className="flex justify-between text-green-600">
                          <span>New Customer Discount</span>
                          <span>-${NEW_CUSTOMER_DISCOUNT.toFixed(2)}</span>
                        </div>
                      )}
                      {'membershipDiscount' in pricing && pricing.membershipDiscount > 0 && (
                        <div className="flex justify-between text-primary">
                          <span>Membership Discount</span>
                          <span>-${pricing.membershipDiscount.toFixed(2)}</span>
                        </div>
                      )}
                      {paymentOption === "full" && 'discount' in pricing && (
                        <div className="flex justify-between text-amber-600">
                          <span>Pay In Full Discount</span>
                          <span>-${pricing.discount.toFixed(2)}</span>
                        </div>
                      )}
                      {customDiscountEnabled && customDiscountValue > 0 && (
                        <div className="flex justify-between text-orange-600">
                          <span>Custom Discount</span>
                          <span>-{customDiscountType === "percent" ? `${customDiscountValue}%` : `$${customDiscountValue}`}</span>
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      {paymentOption === "deposit" ? (
                        <>
                          <div className="flex justify-between">
                            <span className="font-semibold">Deposit Due Now</span>
                            <span className="text-2xl font-bold text-primary">${DEPOSIT_AMOUNT}</span>
                          </div>
                          <div className="flex justify-between text-sm text-muted-foreground">
                            <span>Balance After Service</span>
                            <span>${('balanceDue' in pricing ? pricing.balanceDue : 0).toFixed(2)}</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex justify-between">
                          <span className="font-semibold">Total Due Now</span>
                          <span className="text-2xl font-bold text-primary">${('finalAmount' in pricing ? pricing.finalAmount : pricing.total).toFixed(2)}</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 pt-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Value Highlights</p>
                      <div className="space-y-1.5">
                        <div className="flex items-start gap-2 text-xs">
                          <CheckCircle className="w-3 h-3 text-green-500 mt-0.5" />
                          <span>$60 New Customer Discount applied</span>
                        </div>
                        <div className="flex items-start gap-2 text-xs">
                          <CheckCircle className="w-3 h-3 text-green-500 mt-0.5" />
                          <span>Google Guaranteed service</span>
                        </div>
                        <div className="flex items-start gap-2 text-xs">
                          <CheckCircle className="w-3 h-3 text-green-500 mt-0.5" />
                          <span>Background-checked professionals</span>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Select a home size to see pricing</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-card border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  Quick Scripts
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="p-2 rounded bg-accent/50 hover:bg-accent transition-colors cursor-pointer">
                  <p className="text-xs font-semibold">Opening</p>
                  <p className="text-xs text-muted-foreground">"Hi! Thanks for calling Novara. How can I help you today?"</p>
                </div>
                <div className="p-2 rounded bg-accent/50 hover:bg-accent transition-colors cursor-pointer">
                  <p className="text-xs font-semibold">Pricing Intro</p>
                  <p className="text-xs text-muted-foreground">"Our pricing is based on home size. What's the square footage?"</p>
                </div>
                <div className="p-2 rounded bg-accent/50 hover:bg-accent transition-colors cursor-pointer">
                  <p className="text-xs font-semibold">Close</p>
                  <p className="text-xs text-muted-foreground">"I have an opening on [DATE]. Can I get you booked?"</p>
                </div>
                <div className="p-2 rounded bg-accent/50 hover:bg-accent transition-colors cursor-pointer">
                  <p className="text-xs font-semibold">Value Prop</p>
                  <p className="text-xs text-muted-foreground">"We're Google Guaranteed and all cleaners are background-checked."</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
