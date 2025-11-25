import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Clock, DollarSign, Lock, RefreshCw, Trash2 } from "lucide-react";

const ACCESS_PIN = "1234"; // Change this to your desired 4-digit PIN
import { US_STATES } from "@/lib/us-states";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING, ADD_ONS, MEMBERSHIP_PLANS, calculatePrice, NEW_CUSTOMER_DISCOUNT, DEPOSIT_AMOUNT } from "@/lib/pricing-system";
import { IntakePricingSidebar } from "@/components/admin/IntakePricingSidebar";
import { calculateServiceDuration } from "@/lib/time-slots";
import { CleanerMultiSelect, SelectedCleaner } from "@/components/admin/CleanerMultiSelect";
import { CustomerRecognitionCard, CustomerStatus } from "@/components/admin/CustomerRecognitionCard";
import { calculateDistance } from "@/lib/distance-calculator";

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

export default function BookingIntake() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);

  // PIN Authentication
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinCode, setPinCode] = useState(["", "", "", ""]);
  const [pinError, setPinError] = useState(false);

  // Customer Recognition
  const [customerStatus, setCustomerStatus] = useState<CustomerStatus | null>(null);
  const [checkingCustomer, setCheckingCustomer] = useState(false);

  // Multi-Cleaner Assignment
  const [selectedCleaners, setSelectedCleaners] = useState<SelectedCleaner[]>([]);
  const [customerLocation, setCustomerLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geocoding, setGeocoding] = useState(false);

  // Auto-save timestamp
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Section 1: Customer Information
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [customerSource, setCustomerSource] = useState("New Lead");

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

  // Section 5: Booking Configuration
  const [bookingChannel, setBookingChannel] = useState("Phone");
  const [paymentStatus, setPaymentStatus] = useState("Deposit Paid");
  const [paymentMethod, setPaymentMethod] = useState("Card");
  const [membershipPlan, setMembershipPlan] = useState("none");
  const [applyNewCustomerDiscount, setApplyNewCustomerDiscount] = useState(true);

  // Section 6: Notes
  const [accessNotes, setAccessNotes] = useState("");
  const [teamNotes, setTeamNotes] = useState("");
  const [dispatchNotes, setDispatchNotes] = useState("");

  // Check authentication and restore autosave on mount
  useEffect(() => {
    const hasAccess = sessionStorage.getItem("intake_access");
    if (hasAccess === "true") {
      setIsAuthenticated(true);
      
      // Check for autosaved data
      const autosaved = localStorage.getItem("admin_intake_autosave");
      if (autosaved) {
        try {
          const { timestamp, formData } = JSON.parse(autosaved);
          const savedDate = new Date(timestamp);
          const hoursSinceAutosave = (Date.now() - savedDate.getTime()) / (1000 * 60 * 60);
          
          if (hoursSinceAutosave < 24) {
            toast({
              title: "Unsaved data found",
              description: `Found form data from ${savedDate.toLocaleTimeString()}. Click below to restore.`,
              action: (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => restoreAutosave(formData)}>
                    Restore
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => clearAutosave()}>
                    Discard
                  </Button>
                </div>
              ),
              duration: 10000,
            });
          } else {
            clearAutosave();
          }
        } catch (error) {
          console.error("Error parsing autosave:", error);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCleaners();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (homeSizeId && serviceType) {
      const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
      if (homeSize) {
        const duration = calculateServiceDuration(homeSizeId, serviceType, homeSize.baseHours);
        setEstimatedDuration(duration.toString());
      }
    }
  }, [homeSizeId, serviceType]);

  // Auto-save every 30 seconds
  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = setInterval(() => {
      saveToLocalStorage();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [isAuthenticated, firstName, lastName, email, phone, customerSource, street, city, state, zipCode, 
      bedrooms, bathrooms, dwellingType, pets, homeSizeId, serviceType, addOns, frequency, serviceDate, 
      timeSlot, estimatedDuration, arrivalWindow, bookingChannel, paymentStatus, paymentMethod, 
      membershipPlan, applyNewCustomerDiscount, accessNotes, teamNotes, dispatchNotes, selectedCleaners]);

  // Customer recognition on email change
  useEffect(() => {
    if (email && email.includes('@')) {
      const debounce = setTimeout(() => {
        checkCustomerStatus(email);
      }, 500);
      return () => clearTimeout(debounce);
    }
  }, [email]);

  // Geocode address when complete
  useEffect(() => {
    if (street && city && state && zipCode) {
      const debounce = setTimeout(() => {
        geocodeAddress();
      }, 500);
      return () => clearTimeout(debounce);
    }
  }, [street, city, state, zipCode]);

  // Update cleaner distances when location changes
  useEffect(() => {
    if (customerLocation && cleaners.length > 0) {
      calculateCleanerDistances();
    }
  }, [customerLocation, cleaners]);

  const saveToLocalStorage = () => {
    const formData = {
      firstName, lastName, email, phone, customerSource,
      street, city, state, zipCode, bedrooms, bathrooms, dwellingType, pets,
      homeSizeId, serviceType, addOns, frequency,
      serviceDate, timeSlot, estimatedDuration, arrivalWindow,
      bookingChannel, paymentStatus, paymentMethod, membershipPlan, applyNewCustomerDiscount,
      accessNotes, teamNotes, dispatchNotes,
      selectedCleaners,
    };

    localStorage.setItem("admin_intake_autosave", JSON.stringify({
      timestamp: Date.now(),
      formData,
    }));

    setLastSaved(new Date());
  };

  const restoreAutosave = (formData: any) => {
    setFirstName(formData.firstName || "");
    setLastName(formData.lastName || "");
    setEmail(formData.email || "");
    setPhone(formData.phone || "");
    setCustomerSource(formData.customerSource || "New Lead");
    setStreet(formData.street || "");
    setCity(formData.city || "");
    setState(formData.state || "MD");
    setZipCode(formData.zipCode || "");
    setBedrooms(formData.bedrooms || "");
    setBathrooms(formData.bathrooms || "");
    setDwellingType(formData.dwellingType || "");
    setPets(formData.pets || "None");
    setHomeSizeId(formData.homeSizeId || "");
    setServiceType(formData.serviceType || "standard");
    setAddOns(formData.addOns || []);
    setFrequency(formData.frequency || "One-Time");
    setServiceDate(formData.serviceDate || "");
    setTimeSlot(formData.timeSlot || "");
    setEstimatedDuration(formData.estimatedDuration || "");
    setArrivalWindow(formData.arrivalWindow || "");
    setBookingChannel(formData.bookingChannel || "Phone");
    setPaymentStatus(formData.paymentStatus || "Deposit Paid");
    setPaymentMethod(formData.paymentMethod || "Card");
    setMembershipPlan(formData.membershipPlan || "none");
    setApplyNewCustomerDiscount(formData.applyNewCustomerDiscount !== false);
    setAccessNotes(formData.accessNotes || "");
    setTeamNotes(formData.teamNotes || "");
    setDispatchNotes(formData.dispatchNotes || "");
    setSelectedCleaners(formData.selectedCleaners || []);

    toast({ title: "Data restored", description: "Form data has been restored from autosave" });
  };

  const clearAutosave = () => {
    localStorage.removeItem("admin_intake_autosave");
    setLastSaved(null);
    toast({ title: "Autosave cleared", description: "Autosaved data has been discarded" });
  };

  const checkCustomerStatus = async (emailToCheck: string) => {
    setCheckingCustomer(true);
    try {
      // Check if customer exists
      const { data: customer } = await supabase
        .from("customers")
        .select("*")
        .eq("email", emailToCheck)
        .maybeSingle();

      // Check for active membership
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

  const geocodeAddress = async () => {
    setGeocoding(true);
    try {
      const { data, error } = await supabase.functions.invoke("geocode-address", {
        body: { address: street, city, state, zip: zipCode },
      });

      if (error) throw error;
      if (data?.lat && data?.lng) {
        setCustomerLocation({ lat: data.lat, lng: data.lng });
      }
    } catch (error) {
      console.error("Geocoding error:", error);
      toast({
        title: "Could not geocode address",
        description: "Cleaners will be shown without distance sorting",
        variant: "destructive",
      });
    } finally {
      setGeocoding(false);
    }
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

        // Filter out cleaners beyond max travel distance
        if (cleaner.max_travel_miles && distance > cleaner.max_travel_miles) {
          return null;
        }

        return { ...cleaner, distance };
      }
      return cleaner;
    }).filter(Boolean) as Cleaner[];

    // Sort by distance (closest first)
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

    // Auto-focus next input
    if (value && index < 3) {
      const nextInput = document.getElementById(`pin-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handlePinSubmit = () => {
    const enteredPin = pinCode.join("");
    if (enteredPin === ACCESS_PIN) {
      sessionStorage.setItem("intake_access", "true");
      setIsAuthenticated(true);
      setPinError(false);
    } else {
      setPinError(true);
      setPinCode(["", "", "", ""]);
      document.getElementById("pin-0")?.focus();
    }
  };

  const validateForm = () => {
    if (!firstName || !lastName || !email || !phone) {
      toast({ title: "Missing customer info", description: "Please fill in all customer fields", variant: "destructive" });
      return false;
    }
    if (!street || !city || !state || !zipCode) {
      toast({ title: "Missing address", description: "Please fill in all address fields", variant: "destructive" });
      return false;
    }
    if (!homeSizeId || !serviceType) {
      toast({ title: "Missing service details", description: "Please select home size and service type", variant: "destructive" });
      return false;
    }
    if (!serviceDate || !timeSlot) {
      toast({ title: "Missing schedule", description: "Please select service date and time", variant: "destructive" });
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);

    try {
      // Calculate pricing
      const pricing = calculatePrice(
        homeSizeId,
        serviceType,
        addOns,
        membershipPlan,
        false,
        applyNewCustomerDiscount
      );

      // Determine status based on payment status
      let bookingStatus = "pending_payment";
      if (paymentStatus === "Deposit Paid" || paymentStatus === "Paid in Full") {
        bookingStatus = "confirmed";
      }

      // Calculate estimated hours
      const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
      const estimatedHours = homeSize?.baseHours || 0;

      // Insert booking
      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .insert({
          // Customer info
          first_name: firstName,
          last_name: lastName,
          email: email,
          phone: phone,
          customer_id: null,

          // Address
          address: street,
          city: city,
          state: state,
          zip_code: zipCode,

          // Property details
          bedrooms: bedrooms ? parseInt(bedrooms) : null,
          bathrooms: bathrooms ? parseFloat(bathrooms) : null,
          dwelling_type: dwellingType || null,
          pets: pets,

          // Service details
          home_size_id: homeSizeId,
          service_type: serviceType,
          add_ons: addOns,
          frequency: frequency,

          // Scheduling
          service_date: serviceDate,
          time_slot: timeSlot,
          estimated_duration_hours: parseInt(estimatedDuration || "0"),
          arrival_window: arrivalWindow || null,

          // Pricing
          base_price_cents: pricing.basePrice,
          deposit_cents: DEPOSIT_AMOUNT,
          total_estimate_cents: pricing.total,
          full_payment_discount: 0,

          // Configuration
          booking_channel: bookingChannel,
          booker_source: customerSource,
          payment_method: paymentMethod,
          payment_option: paymentStatus === "Paid in Full" ? "full" : "deposit",
          membership_plan: membershipPlan,
          status: bookingStatus,

          // Notes
          access_notes: accessNotes || null,
          team_notes: teamNotes || null,
          dispatch_notes: dispatchNotes || null,
        })
        .select()
        .single();

      if (bookingError) throw bookingError;

      // Create job and assign cleaners if any selected
      if (selectedCleaners.length > 0 && customerLocation) {
        const { data: job, error: jobError } = await supabase
          .from("jobs")
          .insert({
            address: street,
            city: city,
            state: state,
            zip: zipCode,
            lat: customerLocation.lat,
            lng: customerLocation.lng,
            service_type: serviceType,
            start_datetime: `${serviceDate} ${timeSlot.split(' - ')[0]}`,
            duration_est_hours: estimatedHours,
            min_cleaners_required: selectedCleaners.length,
            status: "Assigned",
            sq_ft: homeSize?.minSqft || null,
            bedrooms: bedrooms ? parseInt(bedrooms) : null,
            bathrooms: bathrooms ? parseFloat(bathrooms) : null,
            customer_id: null,
          })
          .select()
          .single();

        if (jobError) throw jobError;

        // Link booking to job
        await supabase
          .from("bookings")
          .update({ job_id: job.id })
          .eq("id", booking.id);

        // Create job assignments
        const assignments = selectedCleaners.map(cleaner => ({
          job_id: job.id,
          cleaner_id: cleaner.id,
          role: cleaner.role,
          distance_miles: cleaner.distance,
          pay_rate_hr: cleaner.hourlyRate,
          estimated_pay_cents: cleaner.hourlyRate * estimatedHours * 100,
          status: "Assigned",
        }));

        const { error: assignmentError } = await supabase
          .from("job_assignments")
          .insert(assignments);

        if (assignmentError) throw assignmentError;
      }

      // Clear autosave on success
      clearAutosave();

      toast({
        title: "Booking created successfully",
        description: `Booking ID: ${booking.id}`,
      });

      navigate("/admin/dispatch");
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

  // Show PIN entry screen if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8">
          <div className="flex flex-col items-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Lock className="w-8 h-8 text-primary" />
            </div>
            
            <div className="text-center">
              <h1 className="text-2xl font-semibold text-foreground mb-2">
                Enter Access Code
              </h1>
              <p className="text-sm text-muted-foreground">
                Enter the 4-digit PIN to access the booking intake form
              </p>
            </div>

            <div className="flex gap-3">
              {pinCode.map((digit, index) => (
                <Input
                  key={index}
                  id={`pin-${index}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handlePinChange(index, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !digit && index > 0) {
                      document.getElementById(`pin-${index - 1}`)?.focus();
                    }
                    if (e.key === "Enter" && pinCode.every(d => d)) {
                      handlePinSubmit();
                    }
                  }}
                  className="w-14 h-14 text-center text-2xl font-semibold"
                  autoFocus={index === 0}
                />
              ))}
            </div>

            {pinError && (
              <p className="text-sm text-destructive">
                Incorrect PIN. Please try again.
              </p>
            )}

            <Button
              onClick={handlePinSubmit}
              disabled={!pinCode.every(d => d)}
              className="w-full"
              size="lg"
            >
              Access Intake Form
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate("/admin/dispatch")}>
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold">Phone Booking Intake</h1>
                <p className="text-sm text-muted-foreground">
                  Create booking for CTS Care Team
                  {lastSaved && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      • Last saved: {lastSaved.toLocaleTimeString()}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="lg" onClick={clearAutosave}>
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Form
              </Button>
              <Button onClick={handleSubmit} disabled={loading} size="lg">
                <Save className="w-4 h-4 mr-2" />
                {loading ? "Saving..." : "Create Booking"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Section 1: Customer Information */}
            <Card>
              <CardHeader>
                <CardTitle>Customer Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name *</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="John"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name *</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Smith"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="john@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone *</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>

                {/* Customer Recognition */}
                {checkingCustomer && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Checking customer status...
                  </div>
                )}
                <CustomerRecognitionCard status={customerStatus} />
                <div className="space-y-2">
                  <Label htmlFor="customerSource">Customer Source</Label>
                  <Select value={customerSource} onValueChange={setCustomerSource}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
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

            {/* Section 2: Service Address */}
            <Card>
              <CardHeader>
                <CardTitle>Service Address</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="street">Street Address *</Label>
                  <Input
                    id="street"
                    value={street}
                    onChange={(e) => setStreet(e.target.value)}
                    placeholder="123 Main St"
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">City *</Label>
                    <Input
                      id="city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Baltimore"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State *</Label>
                    <Select value={state} onValueChange={setState}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {US_STATES.map(s => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="zipCode">ZIP Code *</Label>
                    <Input
                      id="zipCode"
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value)}
                      placeholder="21201"
                      maxLength={5}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bedrooms">Bedrooms</Label>
                    <Select value={bedrooms} onValueChange={setBedrooms}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7].map(n => (
                          <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bathrooms">Bathrooms</Label>
                    <Select value={bathrooms} onValueChange={setBathrooms}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {["1", "1.5", "2", "2.5", "3", "3.5", "4"].map(n => (
                          <SelectItem key={n} value={n}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pets">Pets</Label>
                    <Select value={pets} onValueChange={setPets}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="None">None</SelectItem>
                        <SelectItem value="Dog(s)">Dog(s)</SelectItem>
                        <SelectItem value="Cat(s)">Cat(s)</SelectItem>
                        <SelectItem value="Multiple">Multiple</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dwellingType">Dwelling Type</Label>
                  <Select value={dwellingType} onValueChange={setDwellingType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select dwelling type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Single Family">Single Family</SelectItem>
                      <SelectItem value="Townhouse">Townhouse</SelectItem>
                      <SelectItem value="Apartment">Apartment</SelectItem>
                      <SelectItem value="Condo">Condo</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Section 3: Service Details */}
            <Card>
              <CardHeader>
                <CardTitle>Service Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="homeSize">Home Size *</Label>
                  <Select value={homeSizeId} onValueChange={setHomeSizeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select home size" />
                    </SelectTrigger>
                    <SelectContent>
                      {HOME_SIZE_RANGES.map(size => (
                        <SelectItem key={size.id} value={size.id}>
                          {size.label} ({size.baseHours} hours)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="serviceType">Service Type *</Label>
                  <Select value={serviceType} onValueChange={setServiceType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard Cleaning</SelectItem>
                      <SelectItem value="deep">Deep Clean (+${SERVICE_TIER_PRICING.deep.addition})</SelectItem>
                      <SelectItem value="moveInOut">Move-In/Out (+${SERVICE_TIER_PRICING.moveInOut.addition})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <Label>Add-ons (Optional)</Label>
                  {Object.entries(ADD_ONS).map(([key, addon]) => (
                    <div key={key} className="flex items-center space-x-2">
                      <Checkbox
                        id={key}
                        checked={addOns.includes(key)}
                        onCheckedChange={() => handleAddOnToggle(key)}
                      />
                      <label htmlFor={key} className="text-sm cursor-pointer">
                        {addon.label} (+${addon.price})
                      </label>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="frequency">Frequency</Label>
                  <Select value={frequency} onValueChange={setFrequency}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="One-Time">One-Time</SelectItem>
                      <SelectItem value="Weekly">Weekly</SelectItem>
                      <SelectItem value="Biweekly">Biweekly</SelectItem>
                      <SelectItem value="Monthly">Monthly</SelectItem>
                      <SelectItem value="Quarterly">Quarterly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Section 4: Scheduling */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Scheduling
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="serviceDate">Service Date *</Label>
                    <Input
                      id="serviceDate"
                      type="date"
                      value={serviceDate}
                      onChange={(e) => setServiceDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="timeSlot">Time Slot *</Label>
                    <Select value={timeSlot} onValueChange={setTimeSlot}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select time" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="8:00 AM - 12:00 PM">8:00 AM - 12:00 PM</SelectItem>
                        <SelectItem value="12:00 PM - 4:00 PM">12:00 PM - 4:00 PM</SelectItem>
                        <SelectItem value="4:00 PM - 8:00 PM">4:00 PM - 8:00 PM</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="estimatedDuration">Estimated Duration (hours)</Label>
                    <Input
                      id="estimatedDuration"
                      type="number"
                      value={estimatedDuration}
                      onChange={(e) => setEstimatedDuration(e.target.value)}
                      placeholder="Auto-calculated"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="arrivalWindow">Arrival Window (Optional)</Label>
                    <Input
                      id="arrivalWindow"
                      value={arrivalWindow}
                      onChange={(e) => setArrivalWindow(e.target.value)}
                      placeholder="e.g., 10-11 AM"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Section 5: Booking Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Booking Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bookingChannel">Booking Channel</Label>
                    <Select value={bookingChannel} onValueChange={setBookingChannel}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Phone">Phone</SelectItem>
                        <SelectItem value="SMS">SMS</SelectItem>
                        <SelectItem value="Facebook">Facebook</SelectItem>
                        <SelectItem value="Google">Google</SelectItem>
                        <SelectItem value="Referral">Referral</SelectItem>
                        <SelectItem value="AI">AI</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                        <SelectItem value="Website">Website</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="paymentMethod">Payment Method</Label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Card">Card</SelectItem>
                        <SelectItem value="Cash">Cash</SelectItem>
                        <SelectItem value="ACH">ACH</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="paymentStatus">Payment Status</Label>
                  <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Unpaid">Unpaid</SelectItem>
                      <SelectItem value="Deposit Paid">Deposit Paid</SelectItem>
                      <SelectItem value="Paid in Full">Paid in Full</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="membershipPlan">Membership Plan</Label>
                  <Select value={membershipPlan} onValueChange={setMembershipPlan}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Membership</SelectItem>
                      {Object.entries(MEMBERSHIP_PLANS).filter(([key]) => key !== 'none').map(([key, plan]) => (
                        <SelectItem key={key} value={key}>
                          {plan.label} ({(plan.discount * 100)}% off)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="newCustomerDiscount"
                    checked={applyNewCustomerDiscount}
                    onCheckedChange={(checked) => setApplyNewCustomerDiscount(checked === true)}
                  />
                  <label htmlFor="newCustomerDiscount" className="text-sm cursor-pointer">
                    Apply New Customer Discount (-${NEW_CUSTOMER_DISCOUNT})
                  </label>
                </div>
              </CardContent>
            </Card>

            {/* Section 6: Notes */}
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="accessNotes">Access Notes</Label>
                  <Textarea
                    id="accessNotes"
                    value={accessNotes}
                    onChange={(e) => setAccessNotes(e.target.value)}
                    placeholder="Gate codes, key locations, etc."
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="teamNotes">Team Notes (Internal)</Label>
                  <Textarea
                    id="teamNotes"
                    value={teamNotes}
                    onChange={(e) => setTeamNotes(e.target.value)}
                    placeholder="Internal notes for the team"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dispatchNotes">Dispatch Notes (Cleaner-Facing)</Label>
                  <Textarea
                    id="dispatchNotes"
                    value={dispatchNotes}
                    onChange={(e) => setDispatchNotes(e.target.value)}
                    placeholder="Notes for the assigned cleaner"
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Section 7: Cleaner Assignment */}
            <Card>
              <CardHeader>
                <CardTitle>Cleaner Assignment (Optional)</CardTitle>
                {geocoding && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Calculating distances...
                  </p>
                )}
              </CardHeader>
              <CardContent>
                <CleanerMultiSelect
                  cleaners={cleaners}
                  selectedCleaners={selectedCleaners}
                  onSelectionChange={setSelectedCleaners}
                />
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Pricing Sidebar */}
          <div className="lg:col-span-1">
            <IntakePricingSidebar
              homeSizeId={homeSizeId}
              serviceType={serviceType}
              addOns={addOns}
              membershipPlan={membershipPlan}
              applyNewCustomerDiscount={applyNewCustomerDiscount}
              selectedCleaners={selectedCleaners}
              estimatedHours={parseFloat(estimatedDuration || "0")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
