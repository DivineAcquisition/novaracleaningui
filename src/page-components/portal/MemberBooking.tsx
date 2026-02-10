"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useMembershipCredits } from '@/hooks/use-membership-credits';
import { useAvailability } from '@/hooks/use-availability';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  Clock,
  CreditCard,
  Home,
  Loader2,
  MapPin,
  Sparkles,
  Star,
  User,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, addDays, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { CleanerSelector } from '@/components/portal/CleanerSelector';
import { SchedulePicker } from '@/components/booking/SchedulePicker';
import { HOME_SIZE_RANGES } from '@/lib/pricing-system';

// Steps for the booking flow
const STEPS = [
  { id: 'address', label: 'Address', icon: MapPin },
  { id: 'schedule', label: 'Schedule', icon: Calendar },
  { id: 'cleaner', label: 'Cleaner', icon: User },
  { id: 'confirm', label: 'Confirm', icon: Check },
];

interface SavedAddress {
  id: string;
  street: string;
  unit: string | null;
  city: string;
  state: string;
  zip: string;
  sqft_tier: string;
  bedrooms: number | null;
  bathrooms: number | null;
}

export default function MemberBooking() {
  const router = useRouter();
  const { user, subscription } = useAuth();
  const { credits, loading: creditsLoading, hasCredits } = useMembershipCredits();

  // Form state
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Address state
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [isNewAddress, setIsNewAddress] = useState(false);
  const [addressForm, setAddressForm] = useState({
    street: '',
    unit: '',
    city: '',
    state: '',
    zip: '',
    sqft_tier: '',
    bedrooms: '',
    bathrooms: '',
  });

  // Contact info state
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');

  // Service type state
  const [serviceType, setServiceType] = useState<'standard' | 'deep'>('standard');
  const DEEP_CLEAN_UPSELL = 6500; // $65 in cents

  // Schedule state
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');

  // Cleaner state
  const [selectedCleanerId, setSelectedCleanerId] = useState<string | null>(null);
  const [selectedCleanerName, setSelectedCleanerName] = useState<string>('');
  const [specialInstructions, setSpecialInstructions] = useState('');

  // Load saved addresses and customer phone
  useEffect(() => {
    const fetchCustomerData = async () => {
      if (!user?.id) return;

      // Find customer by email
      const { data: customer } = await supabase
        .from('customers')
        .select('id, phone')
        .eq('email', user.email)
        .single();

      if (!customer) return;

      // Set phone if available
      if (customer.phone) {
        setPhone(customer.phone);
      }

      const { data: addresses } = await supabase
        .from('addresses')
        .select('*')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false });

      if (addresses && addresses.length > 0) {
        setSavedAddresses(addresses);
        setSelectedAddressId(addresses[0].id);
      } else {
        setIsNewAddress(true);
      }
    };

    fetchCustomerData();
  }, [user]);

  // Redirect if not logged in or not a member
  useEffect(() => {
    if (creditsLoading) return;
    
    // Not logged in - redirect to auth
    if (!user) {
      toast.error('Please sign in to access member booking');
      router.push('/auth?returnTo=/portal/book');
      return;
    }
    
    // Not a member - redirect to membership page
    if (!subscription?.subscribed) {
      toast.error('You need an active membership to use credits');
      router.push('/membership');
    }
  }, [creditsLoading, user, subscription, router]);

  const selectedAddress = savedAddresses.find((a) => a.id === selectedAddressId);

  const getAddressZip = () => {
    if (selectedAddress) return selectedAddress.zip;
    return addressForm.zip;
  };

  // Phone number formatting and validation
  const formatPhoneNumber = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhone(formatted);
    setPhoneError('');
  };

  const validatePhone = () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setPhoneError('Please enter a valid 10-digit phone number');
      return false;
    }
    return true;
  };

  const canProceed = () => {
    const phoneDigits = phone.replace(/\D/g, '');
    const hasValidPhone = phoneDigits.length >= 10;
    
    switch (currentStep) {
      case 0: // Address + Phone
        if (isNewAddress) {
          return (
            addressForm.street &&
            addressForm.city &&
            addressForm.state &&
            addressForm.zip &&
            addressForm.sqft_tier &&
            hasValidPhone
          );
        }
        return selectedAddressId !== null && hasValidPhone;
      case 1: // Schedule
        return selectedDate && selectedTimeSlot;
      case 2: // Cleaner (optional)
        return true;
      case 3: // Confirm
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    // Validate phone on step 0
    if (currentStep === 0 && !validatePhone()) {
      return;
    }
    
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else {
      router.push('/account');
    }
  };

  const handleSubmitBooking = async () => {
    if (!user?.email || !credits) {
      toast.error('Please log in to continue');
      return;
    }

    if (!hasCredits) {
      toast.error('No credits available');
      return;
    }

    setIsSubmitting(true);

    try {
      // Get or create customer
      let { data: customer } = await supabase
        .from('customers')
        .select('id, first_name, last_name, phone')
        .eq('email', user.email)
        .single();

      const phoneDigits = phone.replace(/\D/g, '');

      if (!customer) {
        const nameParts = (user.email || '').split('@')[0].split('.');
        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert({
            email: user.email!,
            first_name: nameParts[0] || 'Customer',
            last_name: nameParts[1] || '',
            phone: phoneDigits,
          })
          .select()
          .single();

        if (customerError) throw customerError;
        customer = newCustomer;
      } else if (!customer.phone || customer.phone !== phoneDigits) {
        // Update customer phone if changed or missing
        await supabase
          .from('customers')
          .update({ phone: phoneDigits })
          .eq('id', customer.id);
        customer.phone = phoneDigits;
      }

      // Handle address
      let addressData;
      if (isNewAddress) {
        // Create new address
        const { data: newAddress, error: addressError } = await supabase
          .from('addresses')
          .insert({
            customer_id: customer.id,
            street: addressForm.street,
            unit: addressForm.unit || null,
            city: addressForm.city,
            state: addressForm.state,
            zip: addressForm.zip,
            sqft_tier: addressForm.sqft_tier,
            bedrooms: addressForm.bedrooms ? parseInt(addressForm.bedrooms) : null,
            bathrooms: addressForm.bathrooms ? parseInt(addressForm.bathrooms) : null,
          })
          .select()
          .single();

        if (addressError) throw addressError;
        addressData = newAddress;
      } else {
        addressData = selectedAddress;
      }

      if (!addressData) {
        throw new Error('No address selected');
      }

      // Build dispatch notes with cleaner request if applicable
      const dispatchNotes = selectedCleanerId 
        ? `REQUESTED CLEANER: ${selectedCleanerName} (ID: ${selectedCleanerId})` 
        : null;

      // Calculate upsell price for deep clean
      const upsellAmount = serviceType === 'deep' ? DEEP_CLEAN_UPSELL : 0;

      // Create the booking
      const bookingData = {
        customer_id: customer.id,
        email: user.email!,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: phoneDigits,
        address: `${addressData.street}${addressData.unit ? ` ${addressData.unit}` : ''}`,
        city: addressData.city,
        state: addressData.state,
        zip_code: addressData.zip,
        home_size_id: addressData.sqft_tier,
        bedrooms: addressData.bedrooms,
        bathrooms: addressData.bathrooms,
        service_date: format(selectedDate!, 'yyyy-MM-dd'),
        time_slot: selectedTimeSlot,
        arrival_window: selectedTimeSlot,
        service_type: serviceType,
        membership_plan: credits.membership_plan,
        uses_credit: true,
        base_price_cents: upsellAmount,
        deposit_cents: upsellAmount, // Full upsell amount charged at booking
        total_estimate_cents: upsellAmount,
        status: upsellAmount > 0 ? 'pending_payment' : 'confirmed', // Needs payment if upsell
        access_notes: specialInstructions || null,
        dispatch_notes: dispatchNotes,
        booking_channel: 'portal',
        // cleaner_id left null - will be assigned by dispatch system
        // The requested cleaner preference is stored in dispatch_notes
      };

      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert(bookingData)
        .select()
        .single();

      if (bookingError) throw bookingError;

      // Decrement credit
      const { error: creditError } = await supabase
        .from('membership_credits')
        .update({
          credits_remaining: credits.credits_remaining - 1,
          credits_used: (credits.credits_used || 0) + 1,
        })
        .eq('id', (credits as any).id);

      if (creditError) {
        console.error('Error updating credits:', creditError);
        // Don't throw - booking was successful
      }

      // Reserve the time slot
      if (startTime && endTime) {
        await supabase.rpc('reserve_time_slot', {
          _date: format(selectedDate!, 'yyyy-MM-dd'),
          _start_time: startTime,
          _end_time: endTime,
        });
      }

      // Handle deep clean upsell payment
      if (serviceType === 'deep') {
        toast.success('Booking created! Redirecting to payment...');
        // Redirect to checkout for the upsell payment
        router.push(`/book/checkout?booking_id=${booking.id}&upsell=deep`);
        return;
      }

      // Send confirmation email for standard clean (no payment needed)
      try {
        await supabase.functions.invoke('send-booking-email', {
          body: { bookingId: booking.id, type: 'confirmation' },
        });
      } catch (emailError) {
        console.error('Email send failed:', emailError);
      }

      toast.success('Booking confirmed! Check your email for details.');
      router.push('/account');
    } catch (error: any) {
      console.error('Booking error:', error);
      toast.error(error.message || 'Failed to create booking');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (creditsLoading || !user) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">
            {!user ? 'Checking authentication...' : 'Loading your membership...'}
          </p>
        </div>
      </div>
    );
  }

  // No credits state
  if (!hasCredits) {
    return (
      <div className="min-h-screen bg-gradient-hero">
        <div className="container max-w-2xl mx-auto px-4 py-12">
          <Card className="border-warning/50">
            <CardContent className="py-12 text-center space-y-4">
              <AlertCircle className="w-16 h-16 text-warning mx-auto" />
              <h2 className="text-2xl font-bold">No Credits Available</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                You've used all your cleaning credits for this period. Your credits will
                refresh on{' '}
                {credits?.current_period_end
                  ? format(new Date(credits.current_period_end), 'MMMM d, yyyy')
                  : 'your next billing date'}
                .
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
                <Button onClick={() => router.push('/account')} variant="outline">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Account
                </Button>
                <Button onClick={() => router.push('/book/zip')} className="bg-gradient-primary">
                  Book Without Credit
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-hero pb-24 md:pb-8">
      {/* Header */}
      <div className="bg-background/80 backdrop-blur-sm border-b sticky top-0 z-10">
        <div className="container max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {currentStep === 0 ? 'Account' : 'Back'}
            </Button>

            <div className="flex items-center gap-2">
              <Badge className="bg-primary/10 text-primary">
                <Sparkles className="w-3 h-3 mr-1" />
                {credits?.credits_remaining} Credit{credits?.credits_remaining !== 1 ? 's' : ''}{' '}
                Available
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="container max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-8">
          {STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = index === currentStep;
            const isComplete = index < currentStep;

            return (
              <div
                key={step.id}
                className={cn(
                  'flex flex-col items-center gap-2 flex-1',
                  index < STEPS.length - 1 && 'relative'
                )}
              >
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center transition-all',
                    isActive && 'bg-primary text-white shadow-lg',
                    isComplete && 'bg-success text-white',
                    !isActive && !isComplete && 'bg-muted text-muted-foreground'
                  )}
                >
                  {isComplete ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <StepIcon className="w-5 h-5" />
                  )}
                </div>
                <span
                  className={cn(
                    'text-xs font-medium hidden sm:block',
                    isActive && 'text-primary',
                    isComplete && 'text-success',
                    !isActive && !isComplete && 'text-muted-foreground'
                  )}
                >
                  {step.label}
                </span>

                {/* Connector line */}
                {index < STEPS.length - 1 && (
                  <div
                    className={cn(
                      'absolute top-5 left-[60%] w-[80%] h-0.5',
                      isComplete ? 'bg-success' : 'bg-muted'
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <div className="space-y-6">
          {/* Step 0: Address Selection */}
          {currentStep === 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-primary" />
                  Select Your Address
                </CardTitle>
                <CardDescription>
                  Choose a saved address or add a new one for your cleaning
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Saved Addresses */}
                {savedAddresses.length > 0 && !isNewAddress && (
                  <div className="space-y-3">
                    {savedAddresses.map((address) => (
                      <Card
                        key={address.id}
                        className={cn(
                          'cursor-pointer transition-all hover:shadow-md',
                          selectedAddressId === address.id
                            ? 'border-2 border-primary bg-primary/5'
                            : 'border hover:border-primary/50'
                        )}
                        onClick={() => setSelectedAddressId(address.id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3">
                              <Home className="w-5 h-5 text-primary mt-0.5" />
                              <div>
                                <p className="font-medium">
                                  {address.street}
                                  {address.unit && `, ${address.unit}`}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {address.city}, {address.state} {address.zip}
                                </p>
                                <div className="flex gap-2 mt-2">
                                  <Badge variant="secondary" className="text-xs">
                                    {HOME_SIZE_RANGES.find((h) => h.id === address.sqft_tier)
                                      ?.label || address.sqft_tier}
                                  </Badge>
                                  {address.bedrooms && (
                                    <Badge variant="outline" className="text-xs">
                                      {address.bedrooms} bed
                                    </Badge>
                                  )}
                                  {address.bathrooms && (
                                    <Badge variant="outline" className="text-xs">
                                      {address.bathrooms} bath
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                            {selectedAddressId === address.id && (
                              <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                                <Check className="w-4 h-4 text-white" />
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}

                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setIsNewAddress(true);
                        setSelectedAddressId(null);
                      }}
                    >
                      + Add New Address
                    </Button>
                  </div>
                )}

                {/* New Address Form */}
                {isNewAddress && (
                  <div className="space-y-4">
                    {savedAddresses.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsNewAddress(false);
                          setSelectedAddressId(savedAddresses[0]?.id || null);
                        }}
                      >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Use Saved Address
                      </Button>
                    )}

                    <div className="grid gap-4">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2">
                          <Label htmlFor="street">Street Address</Label>
                          <Input
                            id="street"
                            placeholder="123 Main St"
                            value={addressForm.street}
                            onChange={(e) =>
                              setAddressForm({ ...addressForm, street: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor="unit">Unit/Apt</Label>
                          <Input
                            id="unit"
                            placeholder="Apt 4B"
                            value={addressForm.unit}
                            onChange={(e) =>
                              setAddressForm({ ...addressForm, unit: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <Label htmlFor="city">City</Label>
                          <Input
                            id="city"
                            placeholder="Dallas"
                            value={addressForm.city}
                            onChange={(e) =>
                              setAddressForm({ ...addressForm, city: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor="state">State</Label>
                          <Input
                            id="state"
                            placeholder="TX"
                            maxLength={2}
                            value={addressForm.state}
                            onChange={(e) =>
                              setAddressForm({
                                ...addressForm,
                                state: e.target.value.toUpperCase(),
                              })
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor="zip">ZIP Code</Label>
                          <Input
                            id="zip"
                            placeholder="75001"
                            maxLength={5}
                            value={addressForm.zip}
                            onChange={(e) =>
                              setAddressForm({ ...addressForm, zip: e.target.value })
                            }
                          />
                        </div>
                      </div>

                      <div>
                        <Label htmlFor="sqft_tier">Home Size</Label>
                        <Select
                          value={addressForm.sqft_tier}
                          onValueChange={(value) =>
                            setAddressForm({ ...addressForm, sqft_tier: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select home size" />
                          </SelectTrigger>
                          <SelectContent>
                            {HOME_SIZE_RANGES.map((size) => (
                              <SelectItem key={size.id} value={size.id}>
                                {size.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="bedrooms">Bedrooms</Label>
                          <Select
                            value={addressForm.bedrooms}
                            onValueChange={(value) =>
                              setAddressForm({ ...addressForm, bedrooms: value })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {[1, 2, 3, 4, 5, 6].map((num) => (
                                <SelectItem key={num} value={num.toString()}>
                                  {num} bedroom{num > 1 ? 's' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="bathrooms">Bathrooms</Label>
                          <Select
                            value={addressForm.bathrooms}
                            onValueChange={(value) =>
                              setAddressForm({ ...addressForm, bathrooms: value })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((num) => (
                                <SelectItem key={num} value={num.toString()}>
                                  {num} bathroom{num > 1 ? 's' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Phone Number - Required for all bookings */}
                <Separator className="my-4" />
                <div className="space-y-2">
                  <Label htmlFor="phone" className="flex items-center gap-2">
                    Phone Number <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="(972) 555-0123"
                    value={phone}
                    onChange={handlePhoneChange}
                    className={phoneError ? 'border-destructive' : ''}
                  />
                  {phoneError && (
                    <p className="text-sm text-destructive">{phoneError}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    We'll send booking confirmations and updates via SMS
                  </p>
                </div>

                {/* Service Type Selection */}
                <Separator className="my-4" />
                <div className="space-y-3">
                  <Label className="text-base font-semibold">Service Type</Label>
                  <div className="grid gap-3">
                    {/* Standard Clean - Free with credit */}
                    <Card
                      className={cn(
                        'cursor-pointer transition-all hover:shadow-md',
                        serviceType === 'standard'
                          ? 'border-2 border-primary bg-primary/5'
                          : 'border hover:border-primary/50'
                      )}
                      onClick={() => setServiceType('standard')}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              'w-10 h-10 rounded-full flex items-center justify-center',
                              serviceType === 'standard' ? 'bg-primary text-white' : 'bg-muted'
                            )}>
                              <Sparkles className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="font-semibold">Standard Clean</h4>
                              <p className="text-sm text-muted-foreground">
                                Regular maintenance cleaning
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge className="bg-success text-white">Included</Badge>
                            <p className="text-xs text-muted-foreground mt-1">with credit</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Deep Clean - $65 upsell */}
                    <Card
                      className={cn(
                        'cursor-pointer transition-all hover:shadow-md',
                        serviceType === 'deep'
                          ? 'border-2 border-primary bg-primary/5'
                          : 'border hover:border-primary/50'
                      )}
                      onClick={() => setServiceType('deep')}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              'w-10 h-10 rounded-full flex items-center justify-center',
                              serviceType === 'deep' ? 'bg-primary text-white' : 'bg-muted'
                            )}>
                              <Star className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="font-semibold">Deep Clean</h4>
                              <p className="text-sm text-muted-foreground">
                                Thorough top-to-bottom cleaning
                              </p>
                              <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                                <li>• Inside appliances & cabinets</li>
                                <li>• Baseboards & door frames</li>
                                <li>• Detailed bathroom scrub</li>
                              </ul>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-primary">+$65</p>
                            <p className="text-xs text-muted-foreground">upsell</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 1: Schedule Selection */}
          {currentStep === 1 && (
            <SchedulePicker
              selectedDate={selectedDate}
              selectedTime={selectedTimeSlot}
              onDateSelect={(date) => {
                setSelectedDate(date);
                setSelectedTimeSlot('');
              }}
              onTimeSelect={(date, timeSlot, start, end) => {
                setSelectedDate(date);
                setSelectedTimeSlot(timeSlot);
                setStartTime(start);
                setEndTime(end);
              }}
              showContinue={false}
            />
          )}

          {/* Step 2: Cleaner Selection */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <CleanerSelector
                zipCode={getAddressZip()}
                customerEmail={user?.email || undefined}
                selectedCleanerId={selectedCleanerId}
                onSelectCleaner={(cleanerId, cleanerName) => {
                  setSelectedCleanerId(cleanerId);
                  setSelectedCleanerName(cleanerName || '');
                }}
              />

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Special Instructions</CardTitle>
                  <CardDescription>
                    Any notes for your cleaner (access codes, pets, areas to focus on)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    placeholder="e.g., Gate code is #1234, please focus on the kitchen..."
                    value={specialInstructions}
                    onChange={(e) => setSpecialInstructions(e.target.value)}
                    rows={3}
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 3: Confirmation */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    Booking Summary
                  </CardTitle>
                  <CardDescription>Review your booking details before confirming</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Service Type Summary */}
                  <div className="flex items-start gap-3">
                    <Star className="w-5 h-5 text-primary mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">
                          {serviceType === 'deep' ? 'Deep Clean' : 'Standard Clean'}
                        </p>
                        {serviceType === 'deep' && (
                          <Badge variant="secondary">+$65 upsell</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {serviceType === 'deep' 
                          ? 'Thorough top-to-bottom cleaning with detailed attention'
                          : 'Regular maintenance cleaning'}
                      </p>
                    </div>
                  </div>

                  <Separator />

                  {/* Address Summary */}
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">
                        {isNewAddress
                          ? `${addressForm.street}${addressForm.unit ? ` ${addressForm.unit}` : ''}`
                          : `${selectedAddress?.street}${selectedAddress?.unit ? ` ${selectedAddress?.unit}` : ''}`}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {isNewAddress
                          ? `${addressForm.city}, ${addressForm.state} ${addressForm.zip}`
                          : `${selectedAddress?.city}, ${selectedAddress?.state} ${selectedAddress?.zip}`}
                      </p>
                    </div>
                  </div>

                  <Separator />

                  {/* Schedule Summary */}
                  <div className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">
                        {selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}
                      </p>
                      <p className="text-sm text-muted-foreground">{selectedTimeSlot}</p>
                    </div>
                  </div>

                  <Separator />

                  {/* Cleaner Summary */}
                  <div className="flex items-start gap-3">
                    <User className="w-5 h-5 text-primary mt-0.5" />
                    <div>
                      <p className="font-medium">
                        {selectedCleanerId ? `Requested: ${selectedCleanerName}` : 'No Preference'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {selectedCleanerId
                          ? "We'll do our best to assign your requested cleaner"
                          : "We'll assign our best available cleaner"}
                      </p>
                    </div>
                  </div>

                  {specialInstructions && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-1">
                          Special Instructions
                        </p>
                        <p className="text-sm">{specialInstructions}</p>
                      </div>
                    </>
                  )}

                  <Separator />

                  {/* Credit Usage & Pricing */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between bg-success/10 rounded-lg p-4">
                      <div className="flex items-center gap-3">
                        <CreditCard className="w-5 h-5 text-success" />
                        <div>
                          <p className="font-medium text-success">Using 1 Membership Credit</p>
                          <p className="text-sm text-muted-foreground">
                            {credits?.credits_remaining! - 1} credit
                            {credits?.credits_remaining! - 1 !== 1 ? 's' : ''} remaining after booking
                          </p>
                        </div>
                      </div>
                      <p className="text-xl font-bold text-success">
                        {serviceType === 'standard' ? '$0' : 'Credit Applied'}
                      </p>
                    </div>

                    {serviceType === 'deep' && (
                      <div className="flex items-center justify-between bg-primary/10 rounded-lg p-4">
                        <div className="flex items-center gap-3">
                          <Star className="w-5 h-5 text-primary" />
                          <div>
                            <p className="font-medium text-primary">Deep Clean Upgrade</p>
                            <p className="text-sm text-muted-foreground">
                              Due now to confirm booking
                            </p>
                          </div>
                        </div>
                        <p className="text-2xl font-bold text-primary">$65</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {currentStep === 0 ? 'Cancel' : 'Back'}
            </Button>

            {currentStep < STEPS.length - 1 ? (
              <Button
                onClick={handleNext}
                disabled={!canProceed()}
                className="bg-gradient-primary"
              >
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmitBooking}
                disabled={isSubmitting}
                className={serviceType === 'deep' ? 'bg-gradient-primary' : 'bg-success hover:bg-success/90'}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {serviceType === 'deep' ? 'Processing...' : 'Booking...'}
                  </>
                ) : serviceType === 'deep' ? (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Continue to Payment ($65)
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Confirm Booking
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
