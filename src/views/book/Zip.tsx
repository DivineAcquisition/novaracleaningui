"use client";
import {
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiGiftLine,
  RiMapPinLine,
  RiTimeLine,
  RiVipCrownLine
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useBooking } from "@/contexts/BookingContext";

import { BookingHeader } from "@/components/booking/BookingHeader";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { trackLead } from "@/lib/meta-pixel";
import { SEO } from "@/components/SEO";

type FormMode = 'zip' | 'contact' | 'waitlist' | 'waitlist-success';

export default function BookingZip() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { updateBookingData, createSession, syncSession, resumeSession, sessionId } = useBooking();
  const referralCode = searchParams.get('ref');
  const fbclid = searchParams.get('fbclid');

  const resumeSessionId = searchParams.get('session');
  
  useEffect(() => {
    if (referralCode) {
      updateBookingData({ referralCode: referralCode.toUpperCase() });
    }
  }, [referralCode]);

  useEffect(() => {
    if (resumeSessionId) {
      resumeSession(resumeSessionId).then((restored) => {
        if (restored) {
          router.push('/book/sqft');
        }
      });
    }
  }, [resumeSessionId]);
  
  const [zipCode, setZipCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('zip');
  const [cityState, setCityState] = useState("");
  
  // Contact form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleZipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (zipCode.length !== 5) return;
    
    setIsValidating(true);
    
    // Check if ZIP is in service coverage
    const { data: coverage } = await supabase
      .from('service_coverage_zones')
      .select('city, state')
      .eq('zip_code', zipCode)
      .eq('is_active', true)
      .single();
    
    setIsValidating(false);

    // --- Create booking session & track in database ---
    const newSessionId = await createSession(zipCode);
    const placeholderEmail = `anonymous-${crypto.randomUUID()}@placeholder`;

    Promise.resolve(
      supabase
        .from('abandoned_carts')
        .insert({
          email: placeholderEmail,
          zip_code: zipCode,
          last_step: 'zip',
          session_id: newSessionId,
        })
        .select('id')
        .single()
    ).then(({ data }) => {
      if (data?.id) {
        localStorage.setItem('abandoned_cart_id', data.id);
        localStorage.setItem('abandoned_cart_email', placeholderEmail);
        if (newSessionId) {
          supabase
            .from('booking_sessions')
            .update({ abandoned_cart_id: data.id })
            .eq('id', newSessionId)
            .then(() => {});
        }
      }
    }).catch(err => console.error('Abandoned cart insert error:', err));

    // Insert into leads
    Promise.resolve(
      supabase
        .from('leads')
        .insert({
          first_name: 'Anonymous',
          last_name: 'Visitor',
          zip_code: zipCode,
          status: 'zip_only',
          source: 'Website',
          channel: 'Website',
        })
    ).then(({ error }) => { if (error) console.error('Lead insert error:', error); })
      .catch(err => console.error('Lead insert error:', err));

    if (coverage) {
      // ZIP is in service area - show contact form
      setCityState(`${coverage.city}, ${coverage.state}`);
      setFormMode('contact');
      updateBookingData({ zipCode });

      // Fire Meta Pixel Lead event for in-area ZIPs
      trackLead(zipCode);
    } else {
      // ZIP is NOT in service area - show waitlist form
      setCityState("");
      setFormMode('waitlist');
    }
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !email || !phone) return;
    
    setIsSubmitting(true);
    
    const formattedPhone = phone.replace(/\D/g, '');
    
    updateBookingData({
      firstName,
      lastName,
      email,
      phone: formattedPhone,
    });
    
    syncSession('contact');
    
    // Update existing abandoned_cart row (or create new one)
    const existingCartId = localStorage.getItem('abandoned_cart_id');
    const existingCartEmail = localStorage.getItem('abandoned_cart_email');
    
    if (existingCartId && existingCartEmail) {
      // Update the placeholder row with real contact info
      supabase
        .from('abandoned_carts')
        .update({
          email,
          first_name: firstName,
          last_name: lastName,
          phone: formattedPhone,
          last_step: 'contact',
          session_id: sessionId,
        })
        .eq('id', existingCartId)
        .then(({ error }) => { if (error) console.error('Cart update error:', error); });
      
      // Clean up localStorage placeholder
      localStorage.removeItem('abandoned_cart_email');
    } else {
      // Fallback: create via edge function if no existing cart
      supabase.functions.invoke('track-abandoned-cart', {
        body: {
          email,
          firstName,
          lastName,
          phone: formattedPhone,
          zipCode,
          lastStep: 'contact',
        }
      }).catch(err => console.error('Track cart error:', err));
    }
    
    // Sync lead to GHL CRM (non-blocking)
    supabase.functions.invoke('sync-contact-to-ghl', {
      body: {
        event: 'lead_captured',
        contactData: { firstName, lastName, email, phone: formattedPhone, zipCode, city: cityState.split(', ')[0] || '', state: cityState.split(', ')[1] || '' },
        bookingData: { source: 'Website' },
      }
    }).catch(err => console.error('GHL sync error:', err));

    // Send lead capture webhook with client-side duplicate guard
    const capturedEmails: string[] = JSON.parse(localStorage.getItem('lead_captured_emails') || '[]');
    if (!capturedEmails.includes(email.toLowerCase())) {
      supabase.functions.invoke('send-lead-capture-webhook', {
        body: {
          firstName,
          lastName,
          email,
          phone: formattedPhone,
          zipCode,
          city: cityState.split(', ')[0] || '',
          state: cityState.split(', ')[1] || '',
          source: 'Website',
          landingPage: '/book/zip',
          fbclid: fbclid || undefined,
        }
      }).then(() => {
        const updated = [...capturedEmails, email.toLowerCase()];
        localStorage.setItem('lead_captured_emails', JSON.stringify(updated));
      }).catch(err => console.error('Lead webhook error:', err));
    }
    
    router.push("/book/sqft");
  };

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !email || !phone) return;
    
    setIsSubmitting(true);
    
    const formattedPhone = phone.replace(/\D/g, '');
    
    try {
      const { error } = await supabase.functions.invoke('add-to-waitlist', {
        body: {
          email,
          firstName,
          lastName,
          phone: formattedPhone,
          zipCode,
          source: 'website',
        }
      });
      
      if (error) {
        console.error('Waitlist error:', error);
      }
      
      setFormMode('waitlist-success');
    } catch (err) {
      console.error('Waitlist submission error:', err);
      setFormMode('waitlist-success'); // Still show success to user
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangeZip = () => {
    setFormMode('zip');
    setZipCode("");
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setCityState("");
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhone(formatted);
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      <SEO title="Book a Cleaning" description="Enter your ZIP code to check if Novara Cleaning serves your area. Professional home cleaning starting at $99." />
      {/* Sticky Booking Header */}
      <BookingHeader currentStep={1} totalSteps={6} stepLabel="Location" />

      {/* Hero + Booking Section */}
      <section className="container mx-auto px-4 py-12 md:py-20">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          
          {/* Referral Banner */}
          {referralCode && (
            <div className="flex items-center gap-3 p-4 bg-primary/10 border border-primary/30 rounded-xl animate-fade-in">
              <div className="flex-shrink-0 w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                <RiGiftLine className="w-5 h-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground text-sm">You were referred! 🎉</p>
                <p className="text-xs text-muted-foreground">$50 off your first cleaning is waiting for you.</p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h1 className="text-3xl md:text-4xl tracking-tight lg:text-6xl text-center font-extrabold font-jakarta mx-auto max-w-4xl">
              {formMode === 'waitlist-success' 
                ? "You're On The List! 🎉" 
                : "Book Your Cleaning Today For Only $39"}
            </h1>
            
            {formMode !== 'waitlist-success' && (
              <p className="text-[#2c2c2c] font-normal md:text-sm text-sm">
                {formMode === 'waitlist' 
                  ? "We're not in your area yet, but we're expanding soon!"
                  : "Premium cleaning service at transparent prices. Enter your ZIP code to get started."}
              </p>
            )}
          </div>

          {/* Main Card */}
          <Card variant="outlined" className="border-primary/30 shadow-card overflow-hidden">
            <CardContent className="pt-8 pb-8 space-y-6">
              
              {/* ZIP Code Form */}
              {formMode === 'zip' && (
                <form onSubmit={handleZipSubmit} className="space-y-4 animate-fade-in">
                  <div className="space-y-2">
                    <label htmlFor="zipCode" className="text-sm font-medium text-left block">
                      Enter Your ZIP Code
                    </label>
                    <Input 
                      id="zipCode" 
                      type="text" 
                      inputMode="numeric" 
                      pattern="[0-9]*" 
                      maxLength={5} 
                      placeholder="12345" 
                      value={zipCode} 
                      onChange={e => setZipCode(e.target.value.replace(/\D/g, ''))} 
                      className="h-14 text-lg text-center" 
                      autoFocus 
                    />
                    <p className="text-xs text-muted-foreground">
                      We'll check if we service your area
                    </p>
                  </div>

                  <Button 
                    type="submit" 
                    size="lg" 
                    disabled={zipCode.length !== 5 || isValidating} 
                    className="w-full h-12 md:h-14 text-base md:text-lg font-semibold bg-gradient-primary"
                  >
                    {isValidating ? "Checking..." : "Continue"}
                    <RiArrowRightLine className="w-4 h-4 md:w-5 md:h-5 ml-2" />
                  </Button>
                </form>
              )}

              {/* Contact Details Form (Service Area) */}
              {formMode === 'contact' && (
                <form onSubmit={handleContactSubmit} className="space-y-5 animate-fade-in">
                  {/* Success Message */}
                  <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
                    <RiCheckboxCircleLine className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
                    <div className="text-left">
                      <p className="font-semibold text-foreground">
                        Great news! We service {cityState}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Enter your details to claim your New Year discount
                      </p>
                    </div>
                  </div>

                  {/* Name Fields */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label htmlFor="firstName" className="text-sm font-medium text-left block">
                        First Name
                      </label>
                      <Input
                        id="firstName"
                        type="text"
                        placeholder="John"
                        value={firstName}
                        onChange={e => setFirstName(e.target.value)}
                        className="h-12"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="lastName" className="text-sm font-medium text-left block">
                        Last Name
                      </label>
                      <Input
                        id="lastName"
                        type="text"
                        placeholder="Smith"
                        value={lastName}
                        onChange={e => setLastName(e.target.value)}
                        className="h-12"
                        required
                      />
                    </div>
                  </div>

                  {/* Email Field */}
                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium text-left block">
                      Email
                    </label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="john@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="h-12"
                      required
                    />
                  </div>

                  {/* Phone Field */}
                  <div className="space-y-2">
                    <label htmlFor="phone" className="text-sm font-medium text-left block">
                      Phone Number
                    </label>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="(301) 555-0123"
                      value={phone}
                      onChange={handlePhoneChange}
                      className="h-12"
                      required
                    />
                  </div>

                  {/* Submit Button */}
                  <Button 
                    type="submit" 
                    size="lg" 
                    disabled={!firstName || !lastName || !email || phone.replace(/\D/g, '').length !== 10 || isSubmitting} 
                    className="w-full h-12 md:h-14 text-base md:text-lg font-semibold bg-gradient-primary"
                  >
                    {isSubmitting ? "Processing..." : "Claim My Discount →"}
                  </Button>

                  {/* Change ZIP Link */}
                  <button
                    type="button"
                    onClick={handleChangeZip}
                    className="text-sm text-primary hover:text-primary-hover underline underline-offset-2"
                  >
                    ← Change ZIP code ({zipCode})
                  </button>
                </form>
              )}

              {/* Waitlist Form (Outside Service Area) */}
              {formMode === 'waitlist' && (
                <form onSubmit={handleWaitlistSubmit} className="space-y-5 animate-fade-in">
                  {/* Info Message */}
                  <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <RiMapPinLine className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-left">
                      <p className="font-semibold text-amber-800">
                        We're not in {zipCode} yet
                      </p>
                      <p className="text-sm text-amber-700">
                        But we're expanding to your area soon! Join our waitlist and be the first to know.
                      </p>
                    </div>
                  </div>

                  {/* Benefits */}
                  <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                    <p className="text-sm font-medium text-foreground">Waitlist perks:</p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-center gap-2">
                        <RiCheckboxCircleLine className="w-4 h-4 text-primary" />
                        First to know when we launch in your area
                      </li>
                      <li className="flex items-center gap-2">
                        <RiCheckboxCircleLine className="w-4 h-4 text-primary" />
                        Exclusive early-bird pricing
                      </li>
                      <li className="flex items-center gap-2">
                        <RiCheckboxCircleLine className="w-4 h-4 text-primary" />
                        Special founding member perks
                      </li>
                    </ul>
                  </div>

                  {/* Name Fields */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label htmlFor="firstName" className="text-sm font-medium text-left block">
                        First Name
                      </label>
                      <Input
                        id="firstName"
                        type="text"
                        placeholder="John"
                        value={firstName}
                        onChange={e => setFirstName(e.target.value)}
                        className="h-12"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="lastName" className="text-sm font-medium text-left block">
                        Last Name
                      </label>
                      <Input
                        id="lastName"
                        type="text"
                        placeholder="Smith"
                        value={lastName}
                        onChange={e => setLastName(e.target.value)}
                        className="h-12"
                        required
                      />
                    </div>
                  </div>

                  {/* Email Field */}
                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium text-left block">
                      Email
                    </label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="john@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="h-12"
                      required
                    />
                  </div>

                  {/* Phone Field */}
                  <div className="space-y-2">
                    <label htmlFor="phone" className="text-sm font-medium text-left block">
                      Phone Number
                    </label>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="(301) 555-0123"
                      value={phone}
                      onChange={handlePhoneChange}
                      className="h-12"
                      required
                    />
                  </div>

                  {/* Submit Button */}
                  <Button 
                    type="submit" 
                    size="lg" 
                    disabled={!firstName || !lastName || !email || phone.replace(/\D/g, '').length !== 10 || isSubmitting} 
                    className="w-full h-12 md:h-14 text-base md:text-lg font-semibold bg-gradient-primary"
                  >
                    {isSubmitting ? "Adding to Waitlist..." : "Join the Waitlist"}
                    <RiTimeLine className="w-4 h-4 md:w-5 md:h-5 ml-2" />
                  </Button>

                  {/* Change ZIP Link */}
                  <button
                    type="button"
                    onClick={handleChangeZip}
                    className="text-sm text-primary hover:text-primary-hover underline underline-offset-2"
                  >
                    ← Try a different ZIP code
                  </button>
                </form>
              )}

              {/* Waitlist Success */}
              {formMode === 'waitlist-success' && (
                <div className="space-y-6 animate-fade-in text-center py-4">
                  <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                    <RiCheckboxCircleLine className="w-10 h-10 text-primary" />
                  </div>
                  
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold text-foreground">
                      Thanks for joining, {firstName}!
                    </h2>
                    <p className="text-muted-foreground">
                      We've added you to our waitlist for ZIP code {zipCode}. 
                      You'll be the first to know when we start servicing your area.
                    </p>
                  </div>

                  <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
                    <p>📧 Check your email for a confirmation</p>
                    <p className="mt-1">We'll reach out in the coming months!</p>
                  </div>

                  <Button 
                    onClick={handleChangeZip}
                    variant="outline"
                    className="mt-4"
                  >
                    Check Another ZIP Code
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Membership Promo Card - Only show when not on waitlist success */}
          {formMode !== 'waitlist-success' && (
            <Card className="mt-12 border-2 border-primary/40 bg-gradient-lavender shadow-card">
              <CardContent className="pt-6 pb-6">
                <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-primary rounded-full flex items-center justify-center shadow-lavender">
                      <RiVipCrownLine className="w-6 h-6 md:w-8 md:h-8 text-white" />
                    </div>
                  </div>
                  <div className="flex-1 text-center md:text-left space-y-2">
                    <h3 className="text-lg md:text-xl font-semibold">Join Our Membership Program</h3>
                    <p className="text-sm md:text-base text-muted-foreground">
                      Get priority booking, exclusive discounts up to 30%, and credits that never expire. 
                      Perfect for regular cleaning schedules.
                    </p>
                  </div>
                  <Button onClick={() => router.push("/membership")} size="lg" className="bg-primary hover:bg-primary-hover w-full md:w-auto h-11 md:h-12">
                    Learn More
                    <RiArrowRightLine className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* Footer */}
      <BookingFooter />
    </div>
  );
}
