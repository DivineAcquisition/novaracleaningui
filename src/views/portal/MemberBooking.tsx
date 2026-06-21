"use client";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiBankCardLine,
  RiCalendarLine,
  RiCheckLine,
  RiHomeLine,
  RiLoader4Line,
  RiMapPinLine,
  RiSparklingLine,
  RiStarLine,
  RiTicketLine,
  RiTimeLine,
  RiUserLine
} from "@remixicon/react";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useMembershipCredits } from '@/hooks/use-membership-credits';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { CleanerSelector } from '@/components/portal/CleanerSelector';
import { SchedulePicker } from '@/components/booking/SchedulePicker';
import { AddressAutocomplete } from '@/components/booking/AddressAutocomplete';
import { HOME_SIZE_RANGES, calculatePrice } from '@/lib/pricing-system';
import { SEO } from "@/components/SEO";

const STEPS = [
  { id: 'address', label: 'Address', icon: RiMapPinLine },
  { id: 'schedule', label: 'Schedule', icon: RiCalendarLine },
  { id: 'cleaner', label: 'Cleaner', icon: RiUserLine },
  { id: 'confirm', label: 'Confirm', icon: RiCheckLine },
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

  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [isNewAddress, setIsNewAddress] = useState(false);
  const [addressForm, setAddressForm] = useState({
    street: '', unit: '', city: '', state: '', zip: '', sqft_tier: '', bedrooms: '', bathrooms: '',
  });

  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [serviceType, setServiceType] = useState<'standard' | 'deep'>('standard');
  // Approximation: deep clean is 1.5x standard (50% more) and varies by home size.
  // Edge function also uses this; $65 is a fixed approximation for member credit bookings.
  const DEEP_CLEAN_UPSELL_CENTS = 6500;

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');

  const [selectedCleanerId, setSelectedCleanerId] = useState<string | null>(null);
  const [selectedCleanerName, setSelectedCleanerName] = useState<string>('');
  const [specialInstructions, setSpecialInstructions] = useState('');

  useEffect(() => {
    const fetchCustomerData = async () => {
      if (!user?.id) return;
      const { data: customer } = await supabase
        .from('customers')
        .select('id, phone')
        .eq('email', user.email)
        .single();

      if (!customer) return;
      if (customer.phone) setPhone(customer.phone);

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

  useEffect(() => {
    if (creditsLoading) return;
    if (!user) {
      toast.error('Please sign in to access member booking');
      router.push('/auth?returnTo=/portal/book');
      return;
    }
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
      case 0:
        if (isNewAddress) {
          return addressForm.street && addressForm.city && addressForm.state && addressForm.zip && addressForm.sqft_tier && hasValidPhone;
        }
        return selectedAddressId !== null && hasValidPhone;
      case 1: return selectedDate && selectedTimeSlot;
      case 2: return true;
      case 3: return true;
      default: return false;
    }
  };

  const handleNext = () => {
    if (currentStep === 0 && !validatePhone()) return;
    if (currentStep < STEPS.length - 1) setCurrentStep(currentStep + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
    else router.push('/account');
  };

  const handleSubmitBooking = async () => {
    if (!user?.email) {
      toast.error('Please log in to continue');
      return;
    }

    setIsSubmitting(true);
    try {
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
        await supabase.from('customers').update({ phone: phoneDigits }).eq('id', customer.id);
        customer.phone = phoneDigits;
      }

      let addressData;
      if (isNewAddress) {
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

      if (!addressData) throw new Error('No address selected');

      const dispatchNotes = selectedCleanerId
        ? `REQUESTED CLEANER: ${selectedCleanerName} (ID: ${selectedCleanerId})`
        : null;

      // Money rules (all re-derived authoritatively in portal-book-checkout):
      //   • credit + standard → $0, confirmed instantly
      //   • credit + deep     → deep-clean surcharge, paid via hosted Checkout
      //   • no credit (extra clean) → full v4 service price, paid up front
      const usingCredit = hasCredits;
      const fullPriceCents = Math.round(
        calculatePrice(addressData.sqft_tier, serviceType).total * 100,
      );
      const chargeCents = usingCredit
        ? (serviceType === 'deep' ? DEEP_CLEAN_UPSELL_CENTS : 0)
        : fullPriceCents;
      const needsPayment = chargeCents > 0;

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
        membership_plan: credits?.membership_plan ?? null,
        uses_credit: usingCredit,
        base_price_cents: chargeCents,
        deposit_cents: chargeCents,
        total_estimate_cents: chargeCents,
        status: needsPayment ? 'pending_payment' : 'confirmed',
        access_notes: specialInstructions || null,
        dispatch_notes: dispatchNotes,
        booking_channel: 'portal',
      };

      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert(bookingData)
        .select()
        .single();
      if (bookingError) throw bookingError;

      // Spend a credit only when one is actually being redeemed.
      if (usingCredit && credits) {
        const { error: creditError } = await supabase
          .from('membership_credits')
          .update({
            credits_remaining: credits.credits_remaining - 1,
            credits_used: (credits.credits_used || 0) + 1,
          })
          .eq('id', (credits as any).id);
        if (creditError) console.error('Error updating credits:', creditError);
      }

      if (startTime && endTime) {
        await supabase.rpc('reserve_time_slot', {
          _date: format(selectedDate!, 'yyyy-MM-dd'),
          _start_time: startTime,
          _end_time: endTime,
        });
      }

      // ── Paid bookings (deep-clean upsell or no-credit extra clean):
      //    collect the card via a Stripe-hosted Checkout Session and
      //    finalize on return at /portal/book/success. The portal never
      //    embeds card fields — that flow lives only in the public funnel.
      if (needsPayment) {
        const { data: pay, error: payErr } = await supabase.functions.invoke('portal-book-checkout', {
          body: { action: 'create', bookingId: booking.id },
        });
        if (payErr || (pay as any)?.error || !(pay as any)?.url) {
          throw new Error((pay as any)?.error || payErr?.message || 'Could not start secure checkout');
        }
        toast.success('Redirecting to secure checkout…');
        window.location.href = (pay as any).url as string;
        return;
      }

      // ── Free credit booking — confirmed instantly. Mirror to GHL + email.
      try {
        await supabase.functions.invoke('sync-to-ghl', {
          body: {
            kind: 'booking',
            payload: {
              firstName: customer.first_name,
              lastName: customer.last_name,
              email: user.email,
              phone: phoneDigits,
              address: bookingData.address,
              city: bookingData.city,
              state: bookingData.state,
              zipCode: bookingData.zip_code,
              bookingId: booking.id,
              bookingNumber: (booking as any).booking_number,
              serviceType,
              cleaningType: serviceType === 'deep' ? 'Deep Clean' : 'Standard Clean',
              serviceDate: format(selectedDate!, 'yyyy-MM-dd'),
              timeSlot: selectedTimeSlot,
              homeSize: addressData.sqft_tier,
              membershipPlan: credits?.membership_plan,
              frequency: 'recurring',
              quotedPriceCents: 0,
              totalCents: 0,
              depositPaid: true,
              customerSource: 'Member Portal',
              market: bookingData.state,
              tags: ['portal-booking', `member-${credits?.membership_plan ?? 'none'}`],
            },
          },
        });
      } catch (ghlErr) {
        console.error('GHL sync failed (non-blocking):', ghlErr);
      }

      try {
        await supabase.functions.invoke('send-booking-email', {
          body: {
            type: 'confirmation',
            email: user.email,
            data: {
              firstName: customer.first_name,
              lastName: customer.last_name,
              bookingId: booking.id,
              serviceDate: format(selectedDate!, 'yyyy-MM-dd'),
              timeSlot: selectedTimeSlot,
              serviceType,
              homeSize: addressData.sqft_tier,
              address: bookingData.address,
              city: bookingData.city,
              state: bookingData.state,
              zipCode: bookingData.zip_code,
              totalAmount: 0,
              useCredit: true,
              membershipPlan: credits?.membership_plan,
            },
          },
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

  if (creditsLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <RiLoader4Line className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">
            {!user ? 'Checking authentication...' : 'Loading your membership...'}
          </p>
        </div>
      </div>
    );
  }

  // When the member has no credits left this cycle we don't bounce them to
  // the public funnel anymore — they can book an extra clean right here and
  // pay the full price. With credits, standard cleans are free and a deep
  // clean adds the surcharge.
  const payMode = !hasCredits;
  const displaySqftTier = selectedAddress?.sqft_tier || addressForm.sqft_tier || '';
  const fullPriceCents = displaySqftTier
    ? Math.round(calculatePrice(displaySqftTier, serviceType).total * 100)
    : 0;
  const chargeCents = payMode
    ? fullPriceCents
    : (serviceType === 'deep' ? DEEP_CLEAN_UPSELL_CENTS : 0);
  const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const progressPercent = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-8">
      <SEO title="Book with Credit" description="Use your membership credit to book a cleaning. Choose your address, schedule, and preferred cleaner." noindex />
      {/* Header */}
      <div className="bg-background border-b border-border/50 sticky top-0 z-10">
        <div className="container max-w-4xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <Button variant="ghost" size="sm" onClick={handleBack} className="-ml-2">
              <RiArrowLeftLine className="w-4 h-4 mr-1.5" />
              {currentStep === 0 ? 'Account' : 'Back'}
            </Button>
            <Badge className="bg-primary/10 text-primary border-primary/20 rounded-lg px-3 py-1">
              <RiTicketLine className="w-3.5 h-3.5 mr-1.5" />
              <span className="font-semibold text-xs">
                {payMode
                  ? 'Extra clean'
                  : `${credits?.credits_remaining} Credit${credits?.credits_remaining !== 1 ? 's' : ''}`}
              </span>
            </Badge>
          </div>
          {/* Progress bar */}
          <div className="h-0.5 -mx-4 bg-muted">
            <div
              className="h-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%`, background: 'var(--gradient-primary)' }}
            />
          </div>
        </div>
      </div>

      {/* Steps indicator */}
      <div className="container max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-8">
          {STEPS.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = index === currentStep;
            const isComplete = index < currentStep;

            return (
              <div key={step.id} className={cn('flex flex-col items-center gap-2 flex-1', index < STEPS.length - 1 && 'relative')}>
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300',
                  isActive && 'bg-primary text-white shadow-lg scale-110',
                  isComplete && 'bg-emerald-500 text-white',
                  !isActive && !isComplete && 'bg-muted text-muted-foreground'
                )}>
                  {isComplete ? <RiCheckLine className="w-5 h-5" /> : <StepIcon className="w-5 h-5" />}
                </div>
                <span className={cn(
                  'text-[11px] font-medium hidden sm:block transition-colors',
                  isActive && 'text-primary',
                  isComplete && 'text-emerald-600 dark:text-emerald-400',
                  !isActive && !isComplete && 'text-muted-foreground'
                )}>
                  {step.label}
                </span>

                {index < STEPS.length - 1 && (
                  <div className={cn(
                    'absolute top-5 left-[60%] w-[80%] h-0.5 rounded-full transition-colors duration-300',
                    isComplete ? 'bg-emerald-500' : 'bg-muted'
                  )} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <div className="space-y-6 animate-fade-in">
          {/* Step 0: Address */}
          {currentStep === 0 && (
            <Card className="shadow-md border-border/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <RiMapPinLine className="w-5 h-5 text-primary" />
                  Select Your Address
                </CardTitle>
                <CardDescription>
                  Choose a saved address or add a new one
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {savedAddresses.length > 0 && !isNewAddress && (
                  <div className="space-y-3">
                    {savedAddresses.map((address) => (
                      <Card
                        key={address.id}
                        className={cn(
                          'cursor-pointer transition-all hover:shadow-md',
                          selectedAddressId === address.id
                            ? 'border-2 border-primary bg-primary/5 shadow-md'
                            : 'border hover:border-primary/40'
                        )}
                        onClick={() => setSelectedAddressId(address.id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3">
                              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mt-0.5 flex-shrink-0">
                                <RiHomeLine className="w-4 h-4 text-primary" />
                              </div>
                              <div>
                                <p className="font-medium text-sm">
                                  {address.street}{address.unit && `, ${address.unit}`}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {address.city}, {address.state} {address.zip}
                                </p>
                                <div className="flex gap-2 mt-2">
                                  <Badge variant="secondary" className="text-[10px] rounded-md">
                                    {HOME_SIZE_RANGES.find((h) => h.id === address.sqft_tier)?.label || address.sqft_tier}
                                  </Badge>
                                  {address.bedrooms && (
                                    <Badge variant="outline" className="text-[10px] rounded-md">{address.bedrooms} bed</Badge>
                                  )}
                                  {address.bathrooms && (
                                    <Badge variant="outline" className="text-[10px] rounded-md">{address.bathrooms} bath</Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                            {selectedAddressId === address.id && (
                              <div className="w-6 h-6 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
                                <RiCheckLine className="w-4 h-4 text-white" />
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    <Button variant="outline" className="w-full rounded-xl" onClick={() => { setIsNewAddress(true); setSelectedAddressId(null); }}>
                      + Add New Address
                    </Button>
                  </div>
                )}

                {isNewAddress && (
                  <div className="space-y-4">
                    {savedAddresses.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => { setIsNewAddress(false); setSelectedAddressId(savedAddresses[0]?.id || null); }}>
                        <RiArrowLeftLine className="w-4 h-4 mr-2" /> Use Saved Address
                      </Button>
                    )}
                    <div className="grid gap-4">
                      <AddressAutocomplete
                        label="Street Address *"
                        placeholder="Start typing — Google will validate"
                        initialValue={addressForm.street}
                        onAddressSelect={(addr) => setAddressForm((prev) => ({
                          ...prev,
                          street: addr.street || prev.street,
                          city: addr.city || prev.city,
                          state: addr.state || prev.state,
                          zip: addr.zipCode || prev.zip,
                        }))}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="unit">Unit/Apt</Label>
                          <Input id="unit" placeholder="Apt 4B" value={addressForm.unit} className="rounded-lg" onChange={(e) => setAddressForm({ ...addressForm, unit: e.target.value })} />
                        </div>
                        <div>
                          <Label htmlFor="zip">ZIP Code</Label>
                          <Input id="zip" placeholder="75001" maxLength={5} value={addressForm.zip} className="rounded-lg" onChange={(e) => setAddressForm({ ...addressForm, zip: e.target.value })} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="city">City</Label>
                          <Input id="city" placeholder="Dallas" value={addressForm.city} className="rounded-lg" onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })} />
                        </div>
                        <div>
                          <Label htmlFor="state">State</Label>
                          <Input id="state" placeholder="TX" maxLength={2} value={addressForm.state} className="rounded-lg" onChange={(e) => setAddressForm({ ...addressForm, state: e.target.value.toUpperCase() })} />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="sqft_tier">Home Size</Label>
                        <Select value={addressForm.sqft_tier} onValueChange={(value) => setAddressForm({ ...addressForm, sqft_tier: value })}>
                          <SelectTrigger className="rounded-lg"><SelectValue placeholder="Select home size" /></SelectTrigger>
                          <SelectContent>
                            {HOME_SIZE_RANGES.map((size) => (
                              <SelectItem key={size.id} value={size.id}>{size.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="bedrooms">Bedrooms</Label>
                          <Select value={addressForm.bedrooms} onValueChange={(value) => setAddressForm({ ...addressForm, bedrooms: value })}>
                            <SelectTrigger className="rounded-lg"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              {[1, 2, 3, 4, 5, 6].map((num) => (
                                <SelectItem key={num} value={num.toString()}>{num} bedroom{num > 1 ? 's' : ''}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="bathrooms">Bathrooms</Label>
                          <Select value={addressForm.bathrooms} onValueChange={(value) => setAddressForm({ ...addressForm, bathrooms: value })}>
                            <SelectTrigger className="rounded-lg"><SelectValue placeholder="Select" /></SelectTrigger>
                            <SelectContent>
                              {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((num) => (
                                <SelectItem key={num} value={num.toString()}>{num} bathroom{num > 1 ? 's' : ''}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="phone" className="flex items-center gap-2">
                    Phone Number <span className="text-destructive text-xs">Required</span>
                  </Label>
                  <Input
                    id="phone" type="tel" placeholder="(972) 555-0123"
                    value={phone} onChange={handlePhoneChange}
                    className={cn("rounded-lg", phoneError && 'border-destructive')}
                  />
                  {phoneError && <p className="text-xs text-destructive">{phoneError}</p>}
                  <p className="text-[11px] text-muted-foreground">We'll send booking updates via SMS</p>
                </div>

                <Separator />
                <div className="space-y-3">
                  <Label className="text-base font-semibold">Service Type</Label>
                  <div className="grid gap-3">
                    <Card
                      className={cn(
                        'cursor-pointer transition-all hover:shadow-md',
                        serviceType === 'standard' ? 'border-2 border-primary bg-primary/5 shadow-md' : 'border hover:border-primary/40'
                      )}
                      onClick={() => setServiceType('standard')}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', serviceType === 'standard' ? 'bg-primary text-white' : 'bg-muted')}>
                              <RiSparklingLine className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="font-semibold text-sm">Standard Clean</h4>
                              <p className="text-xs text-muted-foreground">Regular maintenance cleaning</p>
                            </div>
                          </div>
                          <Badge className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-xs">Included</Badge>
                        </div>
                      </CardContent>
                    </Card>

                    <Card
                      className={cn(
                        'cursor-pointer transition-all hover:shadow-md',
                        serviceType === 'deep' ? 'border-2 border-primary bg-primary/5 shadow-md' : 'border hover:border-primary/40'
                      )}
                      onClick={() => setServiceType('deep')}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', serviceType === 'deep' ? 'bg-primary text-white' : 'bg-muted')}>
                              <RiStarLine className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="font-semibold text-sm">Deep Clean</h4>
                              <p className="text-xs text-muted-foreground">Thorough top-to-bottom cleaning</p>
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-1">
                                <span>Inside appliances</span>
                                <span>Baseboards</span>
                                <span>Detailed scrub</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-lg font-bold text-primary">+${(DEEP_CLEAN_UPSELL_CENTS / 100).toFixed(0)}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 1: Schedule */}
          {currentStep === 1 && (
            <div className="animate-fade-in">
              <SchedulePicker
                selectedDate={selectedDate}
                selectedTime={selectedTimeSlot}
                onDateSelect={(date) => { setSelectedDate(date); setSelectedTimeSlot(''); }}
                onTimeSelect={(date, timeSlot, start, end) => { setSelectedDate(date); setSelectedTimeSlot(timeSlot); setStartTime(start); setEndTime(end); }}
                showContinue={false}
              />
            </div>
          )}

          {/* Step 2: Cleaner */}
          {currentStep === 2 && (
            <div className="space-y-6 animate-fade-in">
              <CleanerSelector
                zipCode={getAddressZip()}
                customerEmail={user?.email || undefined}
                selectedCleanerId={selectedCleanerId}
                onSelectCleaner={(cleanerId, cleanerName) => { setSelectedCleanerId(cleanerId); setSelectedCleanerName(cleanerName || ''); }}
              />
              <Card className="shadow-md">
                <CardHeader>
                  <CardTitle className="text-base">Special Instructions</CardTitle>
                  <CardDescription>Access codes, pets, areas to focus on</CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    placeholder="e.g., Gate code is #1234, please focus on the kitchen..."
                    value={specialInstructions}
                    onChange={(e) => setSpecialInstructions(e.target.value)}
                    rows={3}
                    className="rounded-lg"
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 3: Confirm */}
          {currentStep === 3 && (
            <div className="space-y-6 animate-fade-in">
              <Card className="shadow-lg border-0 overflow-hidden">
                <div className="h-0.5 w-full" style={{ background: 'var(--gradient-primary)' }} />
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RiSparklingLine className="w-5 h-5 text-primary" />
                    Booking Summary
                  </CardTitle>
                  <CardDescription>Review your booking details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Service */}
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <RiStarLine className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm">{serviceType === 'deep' ? 'Deep Clean' : 'Standard Clean'}</p>
                        {serviceType === 'deep' && <Badge variant="secondary" className="text-xs">+${(DEEP_CLEAN_UPSELL_CENTS / 100).toFixed(0)}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {serviceType === 'deep' ? 'Thorough top-to-bottom cleaning' : 'Regular maintenance cleaning'}
                      </p>
                    </div>
                  </div>
                  <Separator />

                  {/* Address */}
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <RiMapPinLine className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {isNewAddress
                          ? `${addressForm.street}${addressForm.unit ? ` ${addressForm.unit}` : ''}`
                          : `${selectedAddress?.street}${selectedAddress?.unit ? ` ${selectedAddress?.unit}` : ''}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isNewAddress
                          ? `${addressForm.city}, ${addressForm.state} ${addressForm.zip}`
                          : `${selectedAddress?.city}, ${selectedAddress?.state} ${selectedAddress?.zip}`}
                      </p>
                    </div>
                  </div>
                  <Separator />

                  {/* Schedule */}
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <RiCalendarLine className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}</p>
                      <p className="text-xs text-muted-foreground">{selectedTimeSlot}</p>
                    </div>
                  </div>
                  <Separator />

                  {/* Cleaner */}
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <RiUserLine className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {selectedCleanerId ? `Requested: ${selectedCleanerName}` : 'No Preference'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selectedCleanerId ? "We'll do our best to assign your requested cleaner" : "We'll assign our best available cleaner"}
                      </p>
                    </div>
                  </div>

                  {specialInstructions && (
                    <>
                      <Separator />
                      <div className="rounded-xl bg-muted/40 p-3">
                        <p className="text-[11px] font-medium text-muted-foreground mb-1 uppercase tracking-wider">Special Instructions</p>
                        <p className="text-sm">{specialInstructions}</p>
                      </div>
                    </>
                  )}

                  <Separator />

                  {/* Pricing */}
                  <div className="space-y-3">
                    {payMode ? (
                      <div className="flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                            <RiBankCardLine className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-semibold text-sm text-primary">
                              {serviceType === 'deep' ? 'Deep Clean' : 'Standard Clean'} — extra booking
                            </p>
                            <p className="text-xs text-muted-foreground">
                              No credits left this cycle &middot; paid in full now
                            </p>
                          </div>
                        </div>
                        <p className="text-2xl font-bold text-primary">{usd(chargeCents)}</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                              <RiBankCardLine className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div>
                              <p className="font-semibold text-sm text-emerald-700 dark:text-emerald-400">Using 1 Membership Credit</p>
                              <p className="text-xs text-muted-foreground">
                                {(credits?.credits_remaining ?? 1) - 1} credit{(credits?.credits_remaining ?? 1) - 1 !== 1 ? 's' : ''} remaining
                              </p>
                            </div>
                          </div>
                          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                            {serviceType === 'standard' ? '$0' : 'Applied'}
                          </p>
                        </div>

                        {serviceType === 'deep' && (
                          <div className="flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                                <RiStarLine className="w-4 h-4 text-primary" />
                              </div>
                              <div>
                                <p className="font-semibold text-sm text-primary">Deep Clean Upgrade</p>
                                <p className="text-xs text-muted-foreground">Due now to confirm</p>
                              </div>
                            </div>
                            <p className="text-2xl font-bold text-primary">${(DEEP_CLEAN_UPSELL_CENTS / 100).toFixed(0)}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between pt-4">
            <Button variant="outline" onClick={handleBack} className="rounded-xl">
              <RiArrowLeftLine className="w-4 h-4 mr-2" />
              {currentStep === 0 ? 'Cancel' : 'Back'}
            </Button>

            {currentStep < STEPS.length - 1 ? (
              <Button onClick={handleNext} disabled={!canProceed()} className="bg-gradient-primary rounded-xl shadow-md">
                Continue <RiArrowRightLine className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmitBooking}
                disabled={isSubmitting}
                className={cn(
                  "rounded-xl shadow-md",
                  chargeCents > 0 ? 'bg-gradient-primary' : 'bg-emerald-600 hover:bg-emerald-700'
                )}
              >
                {isSubmitting ? (
                  <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> {chargeCents > 0 ? 'Processing...' : 'Booking...'}</>
                ) : chargeCents > 0 ? (
                  <><RiBankCardLine className="w-4 h-4 mr-2" /> Continue to Payment ({usd(chargeCents)})</>
                ) : (
                  <><RiCheckLine className="w-4 h-4 mr-2" /> Confirm Booking</>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
