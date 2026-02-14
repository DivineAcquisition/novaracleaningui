import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { LeadIntakeSection, LeadIntakeData } from "@/components/sales/LeadIntakeSection";
import { useServiceCoverage } from "@/hooks/use-sales-data";
import { QualificationSection, QualificationData } from "@/components/sales/QualificationSection";
import { LiveQuotePanel } from "@/components/sales/LiveQuotePanel";
import { SalesAssistPanel } from "@/components/sales/SalesAssistPanel";
import { BookingConfirmationSection } from "@/components/sales/BookingConfirmationSection";
import { FollowUpScheduler } from "@/components/sales/FollowUpScheduler";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toast as toastHook } from "@/hooks/use-toast";
import {
  Headset, Save, CheckCircle, BarChart3, RotateCcw, Pencil, Lock,
  Clock, DollarSign, RefreshCw, Trash2, ArrowLeft,
} from "lucide-react";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING, ADD_ONS, MEMBERSHIP_PLANS, calculatePrice, NEW_CUSTOMER_DISCOUNT, DEPOSIT_AMOUNT } from "@/lib/pricing-system";
import { IntakePricingSidebar } from "@/components/admin/IntakePricingSidebar";
import { calculateServiceDuration } from "@/lib/time-slots";
import { CleanerMultiSelect, SelectedCleaner } from "@/components/admin/CleanerMultiSelect";
import { CustomerRecognitionCard, CustomerStatus } from "@/components/admin/CustomerRecognitionCard";
import { calculateDistance } from "@/lib/distance-calculator";
import { AddressAutocomplete } from "@/components/admin/AddressAutocomplete";
import { useCustomerSearch, CustomerSearchResult } from "@/hooks/use-sales-data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, UserCheck, ShoppingCart, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const ACCESS_PIN = "1234";
const AUTOSAVE_KEY = "sales_tool_autosave";
const AUTOSAVE_INTERVAL = 30000;

const initialLead: LeadIntakeData = {
  firstName: "", lastName: "", phone: "", email: "",
  source: "Website", channel: "Phone Call", activeChannel: "Phone Call",
  notes: "", isExistingCustomer: false,
};

const initialQualification: QualificationData = {
  serviceType: "standard", propertyType: "", bedrooms: 0, bathrooms: 0,
  sqft: "", homeSizeId: "", zipCode: "", frequency: "One-Time",
  preferredDate: "", preferredTime: "", specialRequests: "", urgency: "", addOns: [],
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

export default function SalesTool() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

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

  // ─── Active tab ───
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(tabParam === "intake" ? "intake" : "sales");

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchParams(tab === "sales" ? {} : { tab });
  };

  // ─── Customer Search (shared) ───
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: searchResults, isLoading: searchLoading } = useCustomerSearch(searchQuery);

  const handleSelectSearchResult = (result: CustomerSearchResult) => {
    // Fill sales tab lead data
    setLead(prev => ({
      ...prev,
      firstName: result.firstName,
      lastName: result.lastName,
      email: result.email,
      phone: result.phone || "",
      isExistingCustomer: true,
    }));
    // Fill intake tab customer fields
    setIntakeFirstName(result.firstName);
    setIntakeLastName(result.lastName);
    setIntakeEmail(result.email);
    setIntakePhone(result.phone || "");
    setSearchOpen(false);
    setSearchQuery("");
    toast.success(`Loaded: ${result.firstName} ${result.lastName}`);
  };

  // ─── Sales Tab State ───
  const [lead, setLead] = useState<LeadIntakeData>(initialLead);
  const [qual, setQual] = useState<QualificationData>(initialQualification);
  const [saving, setSaving] = useState(false);
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);

  const leadIdParam = searchParams.get("leadId");

  useEffect(() => {
    if (!leadIdParam) return;
    const loadLead = async () => {
      const { data, error } = await supabase.from("leads").select("*").eq("id", leadIdParam).single();
      if (error || !data) { toast.error("Lead not found"); return; }
      const l = data as any;
      setLead({
        firstName: l.first_name || "", lastName: l.last_name || "",
        phone: l.phone || "", email: l.email || "",
        source: l.source || "Website", channel: l.channel || "Phone Call",
        activeChannel: l.active_channel || "Phone Call",
        notes: l.notes || "", isExistingCustomer: l.is_existing_customer || false,
      });
      setQual({
        serviceType: l.service_type || "standard", propertyType: l.property_type || "",
        bedrooms: l.bedrooms || 0, bathrooms: l.bathrooms || 0,
        sqft: l.sqft ? String(l.sqft) : "", homeSizeId: "",
        zipCode: l.zip_code || "", frequency: l.frequency || "One-Time",
        preferredDate: l.preferred_date || "", preferredTime: l.preferred_time || "",
        specialRequests: l.special_requests || "", urgency: l.urgency || "", addOns: [],
      });
      setSavedLeadId(l.id);
      setIsEditing(true);
      setBooked(l.status === "booked");
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
      if (lead.firstName || lead.email || qual.zipCode) {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ lead, qual, timestamp: Date.now() }));
      }
    }, AUTOSAVE_INTERVAL);
    return () => clearInterval(interval);
  }, [lead, qual, savedLeadId, isEditing, isAuthenticated]);

  const handleRestore = () => {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) {
      try {
        const { lead: s, qual: q } = JSON.parse(saved);
        if (s) setLead(s);
        if (q) setQual(q);
        toast.success("Form data restored");
      } catch { toast.error("Failed to restore data"); }
    }
    setShowRestorePrompt(false);
  };

  const handleDiscardRestore = () => {
    localStorage.removeItem(AUTOSAVE_KEY);
    setShowRestorePrompt(false);
  };

  const currentStep = useMemo(() => {
    if (!qual.serviceType) return "service_type";
    if (!qual.homeSizeId) return "home_size";
    if (!qual.zipCode || qual.zipCode.length < 5) return "zip_validation";
    if (!qual.frequency || qual.frequency === "One-Time") return "frequency";
    return "price_presentation";
  }, [qual]);

  const isNewCustomer = !lead.isExistingCustomer;
  const { data: coverageData } = useServiceCoverage(qual.zipCode);

  const handleSaveLead = async () => {
    if (!lead.firstName || !lead.lastName) { toast.error("Lead name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        first_name: lead.firstName, last_name: lead.lastName,
        phone: lead.phone || null, email: lead.email || null,
        source: lead.source, channel: lead.channel,
        active_channel: lead.activeChannel, notes: lead.notes || null,
        is_existing_customer: lead.isExistingCustomer,
        service_type: qual.serviceType || null, property_type: qual.propertyType || null,
        bedrooms: qual.bedrooms || null, bathrooms: qual.bathrooms || null,
        sqft: qual.sqft ? parseInt(qual.sqft) : null, zip_code: qual.zipCode || null,
        frequency: qual.frequency || null, preferred_date: qual.preferredDate || null,
        preferred_time: qual.preferredTime || null, special_requests: qual.specialRequests || null,
        urgency: qual.urgency || null,
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
          await supabase.from("lead_activity_log").insert({ lead_id: (data as any).id, action: "created", notes: `Lead created from ${lead.source} via ${lead.channel}` } as any);
        }
        toast.success("Lead saved!");
      }
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch (err: any) { toast.error("Failed to save lead: " + err.message); }
    finally { setSaving(false); }
  };

  const handleReset = () => {
    setLead(initialLead);
    setQual(initialQualification);
    setSavedLeadId(null);
    setBooked(false);
    setIsEditing(false);
    setSearchParams({});
    localStorage.removeItem(AUTOSAVE_KEY);
    // Also reset intake
    resetIntakeForm();
  };

  // ─── Intake Tab State ───
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [intakeCleaners, setIntakeCleaners] = useState<Cleaner[]>([]);
  const [intakeCustomerStatus, setIntakeCustomerStatus] = useState<CustomerStatus | null>(null);
  const [checkingIntakeCustomer, setCheckingIntakeCustomer] = useState(false);
  const [intakeSelectedCleaners, setIntakeSelectedCleaners] = useState<SelectedCleaner[]>([]);
  const [intakeCustomerLocation, setIntakeCustomerLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [intakeLastSaved, setIntakeLastSaved] = useState<Date | null>(null);

  const [intakeFirstName, setIntakeFirstName] = useState("");
  const [intakeLastName, setIntakeLastName] = useState("");
  const [intakeEmail, setIntakeEmail] = useState("");
  const [intakePhone, setIntakePhone] = useState("");
  const [intakeCustomerSource, setIntakeCustomerSource] = useState("New Lead");
  const [intakeStreet, setIntakeStreet] = useState("");
  const [intakeCity, setIntakeCity] = useState("");
  const [intakeState, setIntakeState] = useState("MD");
  const [intakeZipCode, setIntakeZipCode] = useState("");
  const [intakeBedrooms, setIntakeBedrooms] = useState("");
  const [intakeBathrooms, setIntakeBathrooms] = useState("");
  const [intakeDwellingType, setIntakeDwellingType] = useState("");
  const [intakePets, setIntakePets] = useState("None");
  const [intakeHomeSizeId, setIntakeHomeSizeId] = useState("");
  const [intakeServiceType, setIntakeServiceType] = useState("standard");
  const [intakeAddOns, setIntakeAddOns] = useState<string[]>([]);
  const [intakeFrequency, setIntakeFrequency] = useState("One-Time");
  const [intakeServiceDate, setIntakeServiceDate] = useState("");
  const [intakeTimeSlot, setIntakeTimeSlot] = useState("");
  const [intakeEstimatedDuration, setIntakeEstimatedDuration] = useState("");
  const [intakeArrivalWindow, setIntakeArrivalWindow] = useState("");
  const [intakeBookingChannel, setIntakeBookingChannel] = useState("Phone");
  const [intakePaymentStatus, setIntakePaymentStatus] = useState("Deposit Paid");
  const [intakePaymentMethod, setIntakePaymentMethod] = useState("Card");
  const [intakeMembershipPlan, setIntakeMembershipPlan] = useState("none");
  const [intakeApplyNewCustomerDiscount, setIntakeApplyNewCustomerDiscount] = useState(true);
  const [intakeAccessNotes, setIntakeAccessNotes] = useState("");
  const [intakeTeamNotes, setIntakeTeamNotes] = useState("");
  const [intakeDispatchNotes, setIntakeDispatchNotes] = useState("");

  const resetIntakeForm = () => {
    setIntakeFirstName(""); setIntakeLastName(""); setIntakeEmail(""); setIntakePhone("");
    setIntakeCustomerSource("New Lead"); setIntakeStreet(""); setIntakeCity(""); setIntakeState("MD");
    setIntakeZipCode(""); setIntakeBedrooms(""); setIntakeBathrooms(""); setIntakeDwellingType("");
    setIntakePets("None"); setIntakeHomeSizeId(""); setIntakeServiceType("standard");
    setIntakeAddOns([]); setIntakeFrequency("One-Time"); setIntakeServiceDate("");
    setIntakeTimeSlot(""); setIntakeEstimatedDuration(""); setIntakeArrivalWindow("");
    setIntakeBookingChannel("Phone"); setIntakePaymentStatus("Deposit Paid");
    setIntakePaymentMethod("Card"); setIntakeMembershipPlan("none");
    setIntakeApplyNewCustomerDiscount(true); setIntakeAccessNotes("");
    setIntakeTeamNotes(""); setIntakeDispatchNotes(""); setIntakeSelectedCleaners([]);
    setIntakeCustomerStatus(null); setIntakeCustomerLocation(null);
    localStorage.removeItem("admin_intake_autosave");
  };

  // Fetch cleaners for intake tab
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchCleaners = async () => {
      const { data } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name, status, home_lat, home_lng, pay_rate_hr, max_travel_miles")
        .eq("approved", true)
        .order("first_name");
      setIntakeCleaners(data || []);
    };
    fetchCleaners();
  }, [isAuthenticated]);

  // Auto-calc duration
  useEffect(() => {
    if (intakeHomeSizeId && intakeServiceType) {
      const hs = HOME_SIZE_RANGES.find(h => h.id === intakeHomeSizeId);
      if (hs) setIntakeEstimatedDuration(calculateServiceDuration(intakeHomeSizeId, intakeServiceType, hs.baseHours).toString());
    }
  }, [intakeHomeSizeId, intakeServiceType]);

  // Customer recognition
  useEffect(() => {
    if (!intakeEmail || !intakeEmail.includes("@")) return;
    const t = setTimeout(async () => {
      setCheckingIntakeCustomer(true);
      try {
        const { data: customer } = await supabase.from("customers").select("*").eq("email", intakeEmail).maybeSingle();
        const { data: membership } = await supabase.from("membership_credits").select("*").eq("email", intakeEmail)
          .gt("current_period_end", new Date().toISOString()).order("current_period_end", { ascending: false }).maybeSingle();
        if (!customer) {
          setIntakeCustomerStatus({ isNew: true, hasMembership: false });
          setIntakeApplyNewCustomerDiscount(true);
        } else if (membership) {
          setIntakeCustomerStatus({
            isNew: false, hasMembership: true, membershipPlan: membership.membership_plan,
            creditsRemaining: membership.credits_remaining, creditsPerMonth: membership.credits_per_month,
            currentPeriodEnd: membership.current_period_end,
          });
          setIntakeMembershipPlan(membership.membership_plan);
          setIntakeApplyNewCustomerDiscount(false);
        } else {
          setIntakeCustomerStatus({ isNew: false, hasMembership: false });
          setIntakeApplyNewCustomerDiscount(false);
        }
      } catch {} finally { setCheckingIntakeCustomer(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [intakeEmail]);

  // Cleaner distances
  useEffect(() => {
    if (!intakeCustomerLocation || intakeCleaners.length === 0) return;
    const updated = intakeCleaners.map(c => {
      if (c.home_lat && c.home_lng) {
        const d = calculateDistance(intakeCustomerLocation.lat, intakeCustomerLocation.lng, c.home_lat, c.home_lng);
        if (c.max_travel_miles && d > c.max_travel_miles) return null;
        return { ...c, distance: d };
      }
      return c;
    }).filter(Boolean) as Cleaner[];
    updated.sort((a, b) => (a.distance || 9999) - (b.distance || 9999));
    setIntakeCleaners(updated);
  }, [intakeCustomerLocation]);

  const handleIntakeAddressSelect = (addr: { street: string; city: string; state: string; zipCode: string; lat: number; lng: number }) => {
    setIntakeStreet(addr.street); setIntakeCity(addr.city); setIntakeState(addr.state); setIntakeZipCode(addr.zipCode);
    setIntakeCustomerLocation({ lat: addr.lat, lng: addr.lng });
    toast.success("Address selected — calculating distances...");
  };

  const handleIntakeSubmit = async () => {
    if (!intakeFirstName || !intakeLastName || !intakeEmail || !intakePhone) { toastHook({ title: "Missing customer info", variant: "destructive" }); return; }
    if (!intakeStreet || !intakeCity || !intakeState || !intakeZipCode) { toastHook({ title: "Missing address", variant: "destructive" }); return; }
    if (!intakeHomeSizeId || !intakeServiceType) { toastHook({ title: "Missing service details", variant: "destructive" }); return; }
    if (!intakeServiceDate || !intakeTimeSlot) { toastHook({ title: "Missing schedule", variant: "destructive" }); return; }

    setIntakeLoading(true);
    try {
      const pricing = calculatePrice(intakeHomeSizeId, intakeServiceType, intakeAddOns, intakeMembershipPlan, false, intakeApplyNewCustomerDiscount);
      let bookingStatus = "pending_payment";
      if (intakePaymentStatus === "Deposit Paid" || intakePaymentStatus === "Paid in Full") bookingStatus = "confirmed";
      const homeSize = HOME_SIZE_RANGES.find(h => h.id === intakeHomeSizeId);
      const estimatedHours = homeSize?.baseHours || 0;

      const { data: booking, error: bookingError } = await supabase.from("bookings").insert({
        first_name: intakeFirstName, last_name: intakeLastName, email: intakeEmail, phone: intakePhone,
        address: intakeStreet, city: intakeCity, state: intakeState, zip_code: intakeZipCode,
        bedrooms: intakeBedrooms ? parseInt(intakeBedrooms) : null, bathrooms: intakeBathrooms ? parseFloat(intakeBathrooms) : null,
        dwelling_type: intakeDwellingType || null, pets: intakePets,
        home_size_id: intakeHomeSizeId, service_type: intakeServiceType, add_ons: intakeAddOns, frequency: intakeFrequency,
        service_date: intakeServiceDate, time_slot: intakeTimeSlot,
        estimated_duration_hours: parseInt(intakeEstimatedDuration || "0"), arrival_window: intakeArrivalWindow || null,
        base_price_cents: pricing.basePrice, deposit_cents: DEPOSIT_AMOUNT, total_estimate_cents: pricing.total,
        booking_channel: intakeBookingChannel, booker_source: intakeCustomerSource,
        payment_method: intakePaymentMethod, payment_option: intakePaymentStatus === "Paid in Full" ? "full" : "deposit",
        membership_plan: intakeMembershipPlan, status: bookingStatus,
        access_notes: intakeAccessNotes || null, team_notes: intakeTeamNotes || null, dispatch_notes: intakeDispatchNotes || null,
      }).select().single();

      if (bookingError) throw bookingError;

      if (intakeSelectedCleaners.length > 0 && intakeCustomerLocation) {
        const { data: job, error: jobError } = await supabase.from("jobs").insert({
          address: intakeStreet, city: intakeCity, state: intakeState, zip: intakeZipCode,
          lat: intakeCustomerLocation.lat, lng: intakeCustomerLocation.lng,
          service_type: intakeServiceType, start_datetime: `${intakeServiceDate} ${intakeTimeSlot.split(" - ")[0]}`,
          duration_est_hours: estimatedHours, min_cleaners_required: intakeSelectedCleaners.length,
          status: "Assigned", sq_ft: homeSize?.minSqft || null,
          bedrooms: intakeBedrooms ? parseInt(intakeBedrooms) : null, bathrooms: intakeBathrooms ? parseFloat(intakeBathrooms) : null,
        }).select().single();
        if (jobError) throw jobError;
        await supabase.from("bookings").update({ job_id: job.id }).eq("id", booking.id);
        await supabase.from("job_assignments").insert(
          intakeSelectedCleaners.map(c => ({
            job_id: job.id, cleaner_id: c.id, role: c.role, distance_miles: c.distance,
            pay_rate_hr: c.hourlyRate, estimated_pay_cents: c.hourlyRate * estimatedHours * 100, status: "Assigned",
          }))
        );
      }

      localStorage.removeItem("admin_intake_autosave");
      toast.success(`Booking created: ${booking.id}`);
      navigate("/admin/dispatch");
    } catch (err: any) {
      toastHook({ title: "Error creating booking", description: err.message, variant: "destructive" });
    } finally { setIntakeLoading(false); }
  };

  // ─── PIN Gate ───
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8">
          <div className="flex flex-col items-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold text-foreground mb-2">Enter Access Code</h1>
              <p className="text-sm text-muted-foreground">Enter the 4-digit PIN to access the Sales & Intake tool</p>
            </div>
            <div className="flex gap-3">
              {pinCode.map((digit, i) => (
                <Input key={i} id={`sales-pin-${i}`} type="text" inputMode="numeric" maxLength={1}
                  value={digit} onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !digit && i > 0) document.getElementById(`sales-pin-${i - 1}`)?.focus();
                    if (e.key === "Enter" && pinCode.every(d => d)) handlePinSubmit();
                  }}
                  className="w-14 h-14 text-center text-2xl font-semibold" autoFocus={i === 0}
                />
              ))}
            </div>
            {pinError && <p className="text-sm text-destructive">Incorrect PIN. Please try again.</p>}
            <Button onClick={handlePinSubmit} disabled={!pinCode.every(d => d)} className="w-full" size="lg">
              Access Sales & Intake
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ─── Main Layout ───
  return (
    <div className="min-h-screen bg-slate-950">
      {/* Standalone Header */}
      <div className="border-b border-white/10 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Headset className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Novara Sales & Intake</h1>
              <p className="text-xs text-slate-400">
                {isEditing ? `Editing: ${lead.firstName} ${lead.lastName}` : "Sales closer & booking intake"}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/admin/pipeline")} className="border-slate-600 text-slate-300">
              <BarChart3 className="w-4 h-4 mr-1" /> Pipeline
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset} className="border-slate-600 text-slate-300">
              New
            </Button>
            {activeTab === "sales" && (
              <Button size="sm" onClick={handleSaveLead} disabled={saving || !lead.firstName}
                className="bg-amber-500 hover:bg-amber-600 text-black font-semibold">
                {saving ? <><Save className="w-4 h-4 mr-1 animate-spin" /> Saving...</>
                  : isEditing ? <><Pencil className="w-4 h-4 mr-1" /> Update</>
                  : savedLeadId ? <><CheckCircle className="w-4 h-4 mr-1" /> Saved</>
                  : <><Save className="w-4 h-4 mr-1" /> Save Lead</>}
              </Button>
            )}
            {activeTab === "intake" && (
              <Button size="sm" onClick={handleIntakeSubmit} disabled={intakeLoading}
                className="bg-amber-500 hover:bg-amber-600 text-black font-semibold">
                <Save className="w-4 h-4 mr-1" /> {intakeLoading ? "Creating..." : "Create Booking"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 py-6">
        {/* Restore Prompt */}
        {showRestorePrompt && (
          <div className="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-400">
              <RotateCcw className="w-4 h-4" />
              <span className="text-sm">Unsaved form data from a previous session.</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleDiscardRestore} className="border-slate-600 text-slate-300 text-xs">Discard</Button>
              <Button size="sm" onClick={handleRestore} className="bg-amber-500 hover:bg-amber-600 text-black text-xs">Restore</Button>
            </div>
          </div>
        )}

        {/* Shared Customer Search */}
        <div className="mb-4">
          <Popover open={searchOpen && searchQuery.length >= 2} onOpenChange={setSearchOpen}>
            <PopoverTrigger asChild>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <Input
                  placeholder="Search customers, bookings, abandoned carts..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                  onFocus={() => { if (searchQuery.length >= 2) setSearchOpen(true); }}
                  className="pl-10 bg-slate-900 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-[500px] p-0 bg-slate-900 border-slate-700" align="start">
              {searchLoading ? (
                <div className="p-4 text-sm text-slate-400">Searching...</div>
              ) : searchResults && searchResults.length > 0 ? (
                <div className="max-h-64 overflow-y-auto">
                  {searchResults.map((r, i) => (
                    <button key={`${r.email}-${i}`} onClick={() => handleSelectSearchResult(r)}
                      className="w-full p-3 text-left hover:bg-slate-800 border-b border-slate-800 last:border-0 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-white">{r.firstName} {r.lastName}</p>
                        <p className="text-xs text-slate-400">{r.email}{r.phone ? ` • ${r.phone}` : ""}</p>
                      </div>
                      <Badge variant={r.source === "booking" ? "default" : r.source === "abandoned_cart" ? "secondary" : "outline"}
                        className="text-xs shrink-0 ml-2">
                        {r.badge}
                      </Badge>
                    </button>
                  ))}
                </div>
              ) : searchQuery.length >= 2 ? (
                <div className="p-4 text-sm text-slate-400">No results found</div>
              ) : null}
            </PopoverContent>
          </Popover>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="bg-slate-900 border border-slate-800 mb-6">
            <TabsTrigger value="sales" className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400">
              <Headset className="w-4 h-4 mr-2" /> Sales Closer
            </TabsTrigger>
            <TabsTrigger value="intake" className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400">
              <DollarSign className="w-4 h-4 mr-2" /> Booking Intake
            </TabsTrigger>
          </TabsList>

          {/* ═══ SALES TAB ═══ */}
          <TabsContent value="sales">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
              <div className="space-y-6">
                <Card className="bg-slate-900 border-slate-800 p-6">
                  <LeadIntakeSection data={lead} onChange={setLead} />
                </Card>
                <Card className="bg-slate-900 border-slate-800 p-6">
                  <QualificationSection data={qual} onChange={setQual} />
                </Card>
                {savedLeadId && !booked && (
                  <Card className="bg-slate-900 border-slate-800 p-6">
                    <BookingConfirmationSection leadId={savedLeadId} lead={lead} qualification={qual}
                      isNewCustomer={isNewCustomer} onBooked={() => setBooked(true)}
                      coverageCity={coverageData?.city} coverageState={coverageData?.state} />
                  </Card>
                )}
              </div>
              <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
                <Card className="bg-slate-900 border-slate-800 p-4">
                  <LiveQuotePanel homeSizeId={qual.homeSizeId} serviceType={qual.serviceType}
                    frequency={qual.frequency} addOns={qual.addOns} isNewCustomer={isNewCustomer}
                    bedrooms={qual.bedrooms} bathrooms={qual.bathrooms} leadEmail={lead.email}
                    leadId={savedLeadId} leadFirstName={lead.firstName}
                    onStatusAdvance={(s) => toast.info(`Lead status → "${s}"`)} />
                </Card>
                {savedLeadId && (
                  <Card className="bg-slate-900 border-slate-800 p-4">
                    <FollowUpScheduler leadId={savedLeadId} leadName={lead.firstName || "there"} activeChannel={lead.activeChannel} />
                  </Card>
                )}
                <Card className="bg-slate-900 border-slate-800 p-4">
                  <SalesAssistPanel activeChannel={lead.activeChannel} currentStep={currentStep} />
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ═══ INTAKE TAB ═══ */}
          <TabsContent value="intake">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Customer Info */}
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader><CardTitle className="text-white">Customer Information</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>First Name *</Label>
                        <Input value={intakeFirstName} onChange={(e) => setIntakeFirstName(e.target.value)} placeholder="John" />
                      </div>
                      <div className="space-y-2">
                        <Label>Last Name *</Label>
                        <Input value={intakeLastName} onChange={(e) => setIntakeLastName(e.target.value)} placeholder="Smith" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Email *</Label>
                        <Input type="email" value={intakeEmail} onChange={(e) => setIntakeEmail(e.target.value)} placeholder="john@example.com" />
                      </div>
                      <div className="space-y-2">
                        <Label>Phone *</Label>
                        <Input type="tel" value={intakePhone} onChange={(e) => setIntakePhone(e.target.value)} placeholder="(555) 123-4567" />
                      </div>
                    </div>
                    {checkingIntakeCustomer && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RefreshCw className="w-4 h-4 animate-spin" /> Checking customer status...
                      </div>
                    )}
                    <CustomerRecognitionCard status={intakeCustomerStatus} />
                    <div className="space-y-2">
                      <Label>Customer Source</Label>
                      <Select value={intakeCustomerSource} onValueChange={setIntakeCustomerSource}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="New Lead">New Lead</SelectItem>
                          <SelectItem value="Member">Member</SelectItem>
                          <SelectItem value="Returning Client">Returning Client</SelectItem>
                          <SelectItem value="Internal">Internal</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Service Address */}
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader><CardTitle className="text-white">Service Address</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <AddressAutocomplete onAddressSelect={handleIntakeAddressSelect} initialValue={intakeStreet} />
                    <div className="text-xs text-muted-foreground">Auto-filled from address above</div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2"><Label>City *</Label><Input value={intakeCity} readOnly className="bg-muted" /></div>
                      <div className="space-y-2"><Label>State *</Label><Input value={intakeState} readOnly className="bg-muted" /></div>
                      <div className="space-y-2"><Label>ZIP *</Label><Input value={intakeZipCode} readOnly className="bg-muted" maxLength={5} /></div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2"><Label>Bedrooms</Label>
                        <Select value={intakeBedrooms} onValueChange={setIntakeBedrooms}>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>{[1,2,3,4,5,6,7].map(n => <SelectItem key={n} value={n.toString()}>{n}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2"><Label>Bathrooms</Label>
                        <Select value={intakeBathrooms} onValueChange={setIntakeBathrooms}>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>{["1","1.5","2","2.5","3","3.5","4"].map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2"><Label>Pets</Label>
                        <Select value={intakePets} onValueChange={setIntakePets}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="None">None</SelectItem><SelectItem value="Dog(s)">Dog(s)</SelectItem>
                            <SelectItem value="Cat(s)">Cat(s)</SelectItem><SelectItem value="Multiple">Multiple</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2"><Label>Dwelling Type</Label>
                      <Select value={intakeDwellingType} onValueChange={setIntakeDwellingType}>
                        <SelectTrigger><SelectValue placeholder="Select dwelling type" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="house">House</SelectItem><SelectItem value="apartment">Apartment</SelectItem>
                          <SelectItem value="condo">Condo</SelectItem><SelectItem value="office_space">Office Space</SelectItem>
                          <SelectItem value="townhouse">Townhouse</SelectItem><SelectItem value="mansion">Mansion</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Service Details */}
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader><CardTitle className="text-white">Service Details</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2"><Label>Home Size *</Label>
                      <Select value={intakeHomeSizeId} onValueChange={setIntakeHomeSizeId}>
                        <SelectTrigger><SelectValue placeholder="Select home size" /></SelectTrigger>
                        <SelectContent>{HOME_SIZE_RANGES.map(s => <SelectItem key={s.id} value={s.id}>{s.label} ({s.baseHours}h)</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>Service Type *</Label>
                      <Select value={intakeServiceType} onValueChange={setIntakeServiceType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">Standard Cleaning</SelectItem>
                          <SelectItem value="deep">Deep Clean (+${SERVICE_TIER_PRICING.deep.addition})</SelectItem>
                          <SelectItem value="moveInOut">Move-In/Out (+${SERVICE_TIER_PRICING.moveInOut.addition})</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-3"><Label>Add-ons</Label>
                      {Object.entries(ADD_ONS).map(([key, addon]) => (
                        <div key={key} className="flex items-center space-x-2">
                          <Checkbox id={`intake-${key}`} checked={intakeAddOns.includes(key)}
                            onCheckedChange={() => setIntakeAddOns(prev => prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key])} />
                          <label htmlFor={`intake-${key}`} className="text-sm cursor-pointer">{addon.label} (+${addon.price})</label>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2"><Label>Frequency</Label>
                      <Select value={intakeFrequency} onValueChange={setIntakeFrequency}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="One-Time">One-Time</SelectItem><SelectItem value="Weekly">Weekly</SelectItem>
                          <SelectItem value="Biweekly">Biweekly</SelectItem><SelectItem value="Monthly">Monthly</SelectItem>
                          <SelectItem value="Quarterly">Quarterly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Scheduling */}
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader><CardTitle className="text-white flex items-center gap-2"><Clock className="w-5 h-5" /> Scheduling</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Service Date *</Label>
                        <Input type="date" value={intakeServiceDate} onChange={(e) => setIntakeServiceDate(e.target.value)} />
                      </div>
                      <div className="space-y-2"><Label>Time Slot *</Label>
                        <Select value={intakeTimeSlot} onValueChange={setIntakeTimeSlot}>
                          <SelectTrigger><SelectValue placeholder="Select time" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="8:00 AM - 12:00 PM">8:00 AM - 12:00 PM</SelectItem>
                            <SelectItem value="12:00 PM - 4:00 PM">12:00 PM - 4:00 PM</SelectItem>
                            <SelectItem value="4:00 PM - 8:00 PM">4:00 PM - 8:00 PM</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Duration (hours)</Label>
                        <Input type="number" value={intakeEstimatedDuration} onChange={(e) => setIntakeEstimatedDuration(e.target.value)} placeholder="Auto" />
                      </div>
                      <div className="space-y-2"><Label>Arrival Window</Label>
                        <Input value={intakeArrivalWindow} onChange={(e) => setIntakeArrivalWindow(e.target.value)} placeholder="e.g., 10-11 AM" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Booking Config */}
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader><CardTitle className="text-white flex items-center gap-2"><DollarSign className="w-5 h-5" /> Booking Configuration</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2"><Label>Booking Channel</Label>
                        <Select value={intakeBookingChannel} onValueChange={setIntakeBookingChannel}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["Phone","SMS","Facebook","Google","Referral","AI","Other","Website"].map(c =>
                              <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2"><Label>Payment Method</Label>
                        <Select value={intakePaymentMethod} onValueChange={setIntakePaymentMethod}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["Card","Cash","ACH","Other"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2"><Label>Payment Status</Label>
                      <Select value={intakePaymentStatus} onValueChange={setIntakePaymentStatus}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Unpaid">Unpaid</SelectItem>
                          <SelectItem value="Deposit Paid">Deposit Paid</SelectItem>
                          <SelectItem value="Paid in Full">Paid in Full</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2"><Label>Membership</Label>
                      <Select value={intakeMembershipPlan} onValueChange={setIntakeMembershipPlan}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No Membership</SelectItem>
                          {Object.entries(MEMBERSHIP_PLANS).filter(([k]) => k !== "none").map(([k, p]) =>
                            <SelectItem key={k} value={k}>{p.label} ({(p.discount * 100)}% off)</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="intakeNewDiscount" checked={intakeApplyNewCustomerDiscount}
                        onCheckedChange={(c) => setIntakeApplyNewCustomerDiscount(c === true)} />
                      <label htmlFor="intakeNewDiscount" className="text-sm cursor-pointer">Apply New Customer Discount (-${NEW_CUSTOMER_DISCOUNT})</label>
                    </div>
                  </CardContent>
                </Card>

                {/* Notes */}
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader><CardTitle className="text-white">Notes</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2"><Label>Access Notes</Label>
                      <Textarea value={intakeAccessNotes} onChange={(e) => setIntakeAccessNotes(e.target.value)} placeholder="Gate codes, key locations..." rows={3} />
                    </div>
                    <div className="space-y-2"><Label>Team Notes (Internal)</Label>
                      <Textarea value={intakeTeamNotes} onChange={(e) => setIntakeTeamNotes(e.target.value)} placeholder="Internal notes" rows={3} />
                    </div>
                    <div className="space-y-2"><Label>Dispatch Notes (Cleaner-Facing)</Label>
                      <Textarea value={intakeDispatchNotes} onChange={(e) => setIntakeDispatchNotes(e.target.value)} placeholder="Notes for cleaner" rows={3} />
                    </div>
                  </CardContent>
                </Card>

                {/* Cleaner Assignment */}
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader><CardTitle className="text-white">Cleaner Assignment (Optional)</CardTitle></CardHeader>
                  <CardContent>
                    <CleanerMultiSelect cleaners={intakeCleaners} selectedCleaners={intakeSelectedCleaners} onSelectionChange={setIntakeSelectedCleaners} />
                  </CardContent>
                </Card>
              </div>

              {/* Pricing Sidebar */}
              <div className="lg:col-span-1">
                <IntakePricingSidebar homeSizeId={intakeHomeSizeId} serviceType={intakeServiceType}
                  addOns={intakeAddOns} membershipPlan={intakeMembershipPlan}
                  applyNewCustomerDiscount={intakeApplyNewCustomerDiscount}
                  selectedCleaners={intakeSelectedCleaners}
                  estimatedHours={parseFloat(intakeEstimatedDuration || "0")} />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
