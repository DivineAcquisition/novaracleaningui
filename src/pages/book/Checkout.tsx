import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, CreditCard, Loader2, RefreshCw, Gift, Zap } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { calculateFullPaymentWithDiscount } from "@/lib/pricing-system";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";
import { ContactInfoSection } from "@/components/booking/checkout/ContactInfoSection";
import { ServiceAddressSection } from "@/components/booking/checkout/ServiceAddressSection";
import { PropertyDetailsSection } from "@/components/booking/checkout/PropertyDetailsSection";
import { MembershipSection } from "@/components/booking/checkout/MembershipSection";
import { OrderSummaryCard } from "@/components/booking/checkout/OrderSummaryCard";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Checkout" },
];

export default function BookingCheckout() {
  const navigate = useNavigate();
  const { bookingData, currentStep, updateBookingData } = useBooking();
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<any>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [checkingCredit, setCheckingCredit] = useState(false);
  const [creditAvailable, setCreditAvailable] = useState(true);
  const [creditAvailableDate, setCreditAvailableDate] = useState<string>("");

  // Form state
  const [firstName, setFirstName] = useState(bookingData.firstName || "");
  const [lastName, setLastName] = useState(bookingData.lastName || "");
  const [email, setEmail] = useState(bookingData.email || "");
  const [phone, setPhone] = useState(bookingData.phone || "");
  const [address, setAddress] = useState(bookingData.address || "");
  const [city, setCity] = useState(bookingData.city || "");
  const [state, setState] = useState(bookingData.state || "");
  const [bedrooms, setBedrooms] = useState(bookingData.bedrooms?.toString() || "");
  const [bathrooms, setBathrooms] = useState(bookingData.bathrooms?.toString() || "");
  const [dwellingType, setDwellingType] = useState(bookingData.dwellingType || "");
  const [membershipPlan, setMembershipPlan] = useState(bookingData.membershipPlan || "none");
  const [useCredit, setUseCredit] = useState(bookingData.useCredit || false);
  const [paymentOption, setPaymentOption] = useState<'deposit' | 'full'>(bookingData.paymentOption || 'deposit');

  useEffect(() => {
    const init = async () => {
      const { data, error } = await supabase.functions.invoke('get-stripe-publishable-key');
      if (error || !data?.key) {
        toast.error('Payments are temporarily unavailable. Please contact support.');
        return;
      }
      setStripePromise(loadStripe(data.key));
    };
    init();
  }, []);

  // Check if customer is new
  useEffect(() => {
    const checkNewCustomer = async () => {
      if (!email) return;
      
      const { data } = await supabase
        .from('bookings')
        .select('id')
        .eq('email', email)
        .eq('status', 'confirmed')
        .limit(1);
      
      setIsNewCustomer(!data || data.length === 0);
    };
    
    checkNewCustomer();
  }, [email]);

  // Check credit availability
  useEffect(() => {
    if (!useCredit || !user || !bookingData.serviceDate) {
      setCreditAvailable(true);
      return;
    }

    const checkCredit = async () => {
      setCheckingCredit(true);
      try {
        const { data, error } = await supabase.functions.invoke('check-subscription', {
          body: { 
            userId: user.id,
            requestedDate: format(new Date(bookingData.serviceDate), 'yyyy-MM-dd')
          }
        });

        if (error) throw error;

        if (data.canUseCredit) {
          setCreditAvailable(true);
        } else {
          setCreditAvailable(false);
          setCreditAvailableDate(data.nextAvailableDate);
          toast.error(`Credit not available until ${data.nextAvailableDate}`);
        }
      } catch (error) {
        console.error('Error checking credit:', error);
        toast.error('Failed to check credit availability');
        setCreditAvailable(false);
      } finally {
        setCheckingCredit(false);
      }
    };

    checkCredit();
  }, [useCredit, user, bookingData.serviceDate]);

  const fullPaymentPricing = calculateFullPaymentWithDiscount(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    membershipPlan,
    useCredit,
    isNewCustomer
  );

  const handleBack = () => {
    navigate("/book/schedule");
  };

  const handleFieldChange = (field: string, value: any) => {
    switch(field) {
      case 'firstName': setFirstName(value); break;
      case 'lastName': setLastName(value); break;
      case 'email': setEmail(value); break;
      case 'phone': setPhone(value); break;
      case 'address': setAddress(value); break;
      case 'city': setCity(value); break;
      case 'state': setState(value); break;
      case 'bedrooms': setBedrooms(value); break;
      case 'bathrooms': setBathrooms(value); break;
      case 'dwellingType': setDwellingType(value); break;
      case 'membershipPlan': setMembershipPlan(value); break;
      case 'useCredit': setUseCredit(value); break;
    }
  };

  const validateForm = () => {
    if (!firstName || !lastName || !email || !phone) {
      toast.error("Please fill in all contact information");
      return false;
    }
    if (!address || !city || !state) {
      toast.error("Please fill in the complete service address");
      return false;
    }
    if (!bedrooms || !bathrooms || !dwellingType) {
      toast.error("Please fill in all property details");
      return false;
    }
    if (useCredit && !creditAvailable) {
      toast.error("Credit is not available for the selected date");
      return false;
    }
    return true;
  };

  const handleInitializePayment = async () => {
    if (!validateForm()) return;

    setIsProcessing(true);
    setInitError(null);
    
    // Update booking data with all form fields
    const completeBookingData = {
      ...bookingData,
      firstName,
      lastName,
      email,
      phone,
      address,
      city,
      state,
      bedrooms: parseInt(bedrooms) || 0,
      bathrooms: parseFloat(bathrooms) || 0,
      dwellingType,
      membershipPlan,
      useCredit,
      paymentOption,
    };
    
    updateBookingData(completeBookingData);
    
    try {
      const { data, error } = await supabase.functions.invoke("create-payment-intent", {
        body: completeBookingData,
      });

      if (error) {
        throw new Error(error.message || "Failed to initialize payment");
      }

      if (!data) {
        throw new Error("No payment intent data received");
      }

      // If no payment required (member using credit), go directly to success
      if (!data.requiresPayment) {
        toast.success("Booking confirmed!");
        navigate(`/book/success?booking_id=${data.bookingId}`);
        return;
      }

      setClientSecret(data.clientSecret);
      setBookingId(data.bookingId);
    } catch (error: any) {
      const errorMessage = error.message || "Failed to initialize payment. Please try again.";
      setInitError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetryPayment = () => {
    setClientSecret(null);
    setInitError(null);
  };

  const handlePaymentSuccess = () => {
    toast.success("Payment successful!");
    navigate(`/book/success?booking_id=${bookingId}`);
  };

  const isFormValid = firstName && lastName && email && phone && address && city && state && bedrooms && bathrooms && dwellingType;

  return (
    <div className="min-h-screen bg-gradient-hero pb-8">
      <ProgressBar currentStep={currentStep} totalSteps={5} steps={BOOKING_STEPS} />
      
      <div className="container max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Order Summary (sticky on desktop) */}
          <div className="lg:sticky lg:top-8 lg:self-start">
            <OrderSummaryCard 
              bookingData={{ ...bookingData, membershipPlan, useCredit, paymentOption }} 
              isNewCustomer={isNewCustomer} 
            />
          </div>
          
          {/* Right Column - Forms */}
          <div className="space-y-6">
            <Card className="shadow-xl">
              <CardHeader className="text-center space-y-2">
                <div className="mx-auto w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mb-4 shadow-lavender">
                  <CreditCard className="w-8 h-8 text-white" />
                </div>
                <CardTitle className="text-2xl font-bold">Complete Your Booking</CardTitle>
                <CardDescription>Fill in your details and payment information</CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-6">
                {/* New Customer Banner */}
                {isNewCustomer && !user && (
                  <Card className="border-2 border-green-500/50 bg-gradient-to-br from-green-50 to-emerald-50">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center">
                          <Gift className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="font-bold text-green-700">New Customer Special!</p>
                          <p className="text-sm text-green-600">You're saving $60 on this booking 🎉</p>
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-green-700">-$60</div>
                    </CardContent>
                  </Card>
                )}

                <ContactInfoSection
                  firstName={firstName}
                  lastName={lastName}
                  email={email}
                  phone={phone}
                  onChange={handleFieldChange}
                />

                <ServiceAddressSection
                  address={address}
                  city={city}
                  state={state}
                  zipCode={bookingData.zipCode}
                  onChange={handleFieldChange}
                />

                <PropertyDetailsSection
                  bedrooms={bedrooms}
                  bathrooms={bathrooms}
                  dwellingType={dwellingType}
                  onChange={handleFieldChange}
                />

                <MembershipSection
                  membershipPlan={membershipPlan}
                  useCredit={useCredit}
                  creditAvailable={creditAvailable}
                  creditAvailableDate={creditAvailableDate}
                  checkingCredit={checkingCredit}
                  serviceType={bookingData.serviceType}
                  addOns={bookingData.addOns}
                  onChange={handleFieldChange}
                />

                {/* Payment Option Selection */}
                {!useCredit && (
                  <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-secondary/5">
                    <CardContent className="p-6">
                      <h4 className="font-semibold mb-4 flex items-center gap-2">
                        <Zap className="w-5 h-5 text-primary" />
                        Choose Your Payment Option
                      </h4>
                      <RadioGroup 
                        value={paymentOption} 
                        onValueChange={(value: 'deposit' | 'full') => setPaymentOption(value)}
                        className="space-y-4"
                      >
                        <div className={cn(
                          "flex items-start space-x-3 rounded-lg border-2 p-4 transition-all cursor-pointer",
                          paymentOption === 'deposit' ? "border-primary bg-primary/5" : "border-border"
                        )}>
                          <RadioGroupItem value="deposit" id="deposit" className="mt-1" />
                          <Label htmlFor="deposit" className="flex-1 cursor-pointer">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold">Pay Deposit Now</span>
                                <span className="text-lg font-bold text-primary">$75</span>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                Pay the rest after service completion
                              </p>
                            </div>
                          </Label>
                        </div>

                        <div className={cn(
                          "flex items-start space-x-3 rounded-lg border-2 p-4 transition-all cursor-pointer",
                          paymentOption === 'full' ? "border-primary bg-primary/5" : "border-border"
                        )}>
                          <RadioGroupItem value="full" id="full" className="mt-1" />
                          <Label htmlFor="full" className="flex-1 cursor-pointer">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold">Pay in Full</span>
                                  <span className="text-xs font-semibold px-2 py-1 bg-success/20 text-success rounded-full">
                                    Save 10%
                                  </span>
                                </div>
                                <span className="text-lg font-bold text-primary">
                                  ${fullPaymentPricing.finalAmount.toFixed(2)}
                                </span>
                              </div>
                              <p className="text-sm text-success">
                                Total savings: ${fullPaymentPricing.savings.toFixed(2)}
                              </p>
                            </div>
                          </Label>
                        </div>
                      </RadioGroup>
                    </CardContent>
                  </Card>
                )}

                {/* Payment Section */}
                {!clientSecret && !initError && (
                  <Button 
                    size="lg" 
                    onClick={handleInitializePayment}
                    disabled={isProcessing || !isFormValid || checkingCredit || (useCredit && !creditAvailable)}
                    className="w-full h-14"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="mr-2 w-5 h-5 animate-spin" />
                        Initializing Payment...
                      </>
                    ) : (
                      <>
                        Continue to Payment
                        <CreditCard className="ml-2 w-5 h-5" />
                      </>
                    )}
                  </Button>
                )}

                {initError && (
                  <Alert variant="destructive">
                    <AlertDescription className="flex items-center justify-between">
                      <span>{initError}</span>
                      <Button variant="outline" size="sm" onClick={handleRetryPayment}>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Retry
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                {clientSecret && stripePromise && (
                  <Elements stripe={stripePromise} options={{ clientSecret }}>
                    <StripePaymentForm
                      onSuccess={handlePaymentSuccess}
                      amount={paymentOption === 'full' ? fullPaymentPricing.finalAmount : 75}
                    />
                  </Elements>
                )}

                <div className="flex gap-4 pt-4">
                  <Button variant="outline" size="lg" onClick={handleBack} className="flex-1 h-12">
                    <ArrowLeft className="mr-2 w-4 h-4" /> Back
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}