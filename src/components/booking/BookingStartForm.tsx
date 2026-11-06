"use client";

// The first booking step: ZIP check, then contact details (in the service
// area) or the waitlist (outside it). Used in the landing page hero, which is
// where every booking starts. Saves the ZIP, city and state, referral and
// membership parameters to the booking state, records the abandoned cart and
// lead, and sends the visitor on to /book/sqft.

import {
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiGiftLine,
  RiMapPinLine,
  RiTimeLine
} from "@/components/icons";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBooking } from "@/contexts/BookingContext";

import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { trackLead } from "@/lib/meta-pixel";
import { getStoredTrackingData, getTrackingPayload } from "@/hooks/useUTMTracking";

type FormMode = 'zip' | 'contact' | 'waitlist' | 'waitlist-success';

export function BookingStartForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { updateBookingData } = useBooking();
  const referralCode = searchParams.get('ref');
  const fbclid = searchParams.get('fbclid');
  const membershipParam = searchParams.get('membership');
  const homeSizeParam = searchParams.get('homeSize');
  const welcomeCode = searchParams.get('welcome');

  // Capture referral code from URL on mount
  useEffect(() => {
    if (referralCode) {
      updateBookingData({ referralCode: referralCode.toUpperCase() });
    }
  }, [referralCode]);

  // Glow plan pages hand off into this same funnel so membership signup
  // uses Location → Size → Service → Checkout → Details → Confirm.
  useEffect(() => {
    const plan = (membershipParam || "").toLowerCase();
    if (plan === "monthly" || plan === "biweekly" || plan === "weekly") {
      updateBookingData({ membershipPlan: plan, serviceType: "standard" });
    }
    if (homeSizeParam) {
      updateBookingData({ homeSizeId: homeSizeParam });
    }
    if (welcomeCode && /^WELCOME-[A-Z0-9]+$/i.test(welcomeCode)) {
      updateBookingData({ promoCode: welcomeCode.toUpperCase() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipParam, homeSizeParam]);
  
  // ?zip= from the marketing site's ZIP box prefills this step.
  const [zipCode, setZipCode] = useState(() => (searchParams.get("zip") || "").replace(/\D/g, "").slice(0, 5));
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

    // --- Track ZIP submission in database (fire-and-forget) ---
    const placeholderEmail = `anonymous-${crypto.randomUUID()}@placeholder`;

    // Insert into abandoned_carts
    Promise.resolve(
      supabase
        .from('abandoned_carts')
        .insert({ email: placeholderEmail, zip_code: zipCode, last_step: 'zip' })
        .select('id')
        .single()
    ).then(({ data }) => {
      if (data?.id) {
        localStorage.setItem('abandoned_cart_id', data.id);
        localStorage.setItem('abandoned_cart_email', placeholderEmail);
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
      // Persist ZIP + the resolved city/state into the booking context so
      // downstream pages (Details, Checkout, GHL sync) inherit them
      // automatically — no more empty City/State in GHL when the
      // customer drops off before the Details page.
      updateBookingData({
        zipCode,
        city: coverage.city,
        state: coverage.state,
      });

      // Fire Meta Pixel Lead event for in-area ZIPs
      trackLead(zipCode);
    } else {
      // ZIP is NOT in service area - show waitlist form
      setCityState("");
      setFormMode('waitlist');
    }
  };

  // Coming from the marketing site with ?zip=, check it straight away so the
  // visitor lands on the contact step (or the waitlist) without retyping.
  const autoZipChecked = useRef(false);
  useEffect(() => {
    if (autoZipChecked.current || zipCode.length !== 5 || !searchParams.get("zip")) return;
    autoZipChecked.current = true;
    void handleZipSubmit({ preventDefault() {} } as React.FormEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !email || !phone) return;
    
    setIsSubmitting(true);
    
    const formattedPhone = phone.replace(/\D/g, '');
    
    // Update booking data
    updateBookingData({
      firstName,
      lastName,
      email,
      phone: formattedPhone,
    });
    
    // Update existing abandoned_cart row (or create new one)
    const existingCartId = localStorage.getItem('abandoned_cart_id');
    const existingCartEmail = localStorage.getItem('abandoned_cart_email');
    
    // Tracking bag — pulled once and reused for the cart-row stamp,
    // the lead-capture webhook, and any downstream calls in this
    // submit handler.
    const tracking = getStoredTrackingData();
    const trackingPayload = getTrackingPayload();

    if (existingCartId && existingCartEmail) {
      // Update the placeholder row with real contact info + attribution
      supabase
        .from('abandoned_carts')
        .update({
          email,
          first_name: firstName,
          last_name: lastName,
          phone: formattedPhone,
          last_step: 'contact',
          tracking: trackingPayload,
          utm_source: tracking.utm_source,
          utm_medium: tracking.utm_medium,
          utm_campaign: tracking.utm_campaign,
          utm_content: tracking.utm_content,
          utm_term: tracking.utm_term,
          landing_page: tracking.landing_page,
          referrer: tracking.referrer,
          fbclid: tracking.fbclid,
          gclid: tracking.gclid,
          first_visit_at: tracking.first_visit_timestamp,
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
          tracking: trackingPayload,
        }
      }).catch(err => console.error('Track cart error:', err));
    }
    
    // (tracking + trackingPayload already pulled above; reused here.)

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
          source: tracking.utm_source || 'Website',
          landingPage: tracking.landing_page || '/',
          referrer: tracking.referrer || undefined,
          fbclid: tracking.fbclid || fbclid || undefined,
          gclid: tracking.gclid || undefined,
          firstVisitTimestamp: tracking.first_visit_timestamp || undefined,
          utmSource: tracking.utm_source || undefined,
          utmMedium: tracking.utm_medium || undefined,
          utmCampaign: tracking.utm_campaign || undefined,
          utmContent: tracking.utm_content || undefined,
          utmTerm: tracking.utm_term || undefined,
          tracking: trackingPayload,
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
      const trackingPayload = getTrackingPayload();
      const tracking = getStoredTrackingData();
      const { error } = await supabase.functions.invoke('add-to-waitlist', {
        body: {
          email,
          firstName,
          lastName,
          phone: formattedPhone,
          zipCode,
          source: tracking.utm_source || 'website',
          landingPage: tracking.landing_page || undefined,
          referrer: tracking.referrer || undefined,
          utmSource: tracking.utm_source || undefined,
          utmMedium: tracking.utm_medium || undefined,
          utmCampaign: tracking.utm_campaign || undefined,
          utmContent: tracking.utm_content || undefined,
          utmTerm: tracking.utm_term || undefined,
          fbclid: tracking.fbclid || undefined,
          gclid: tracking.gclid || undefined,
          firstVisitTimestamp: tracking.first_visit_timestamp || undefined,
          tracking: trackingPayload,
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
    <div className="space-y-6">
          {/* Referral Banner */}
          {referralCode && (
            <div className="flex items-center gap-3 p-4 bg-primary/10 border border-primary/30 rounded-xl animate-fade-in">
              <div className="flex-shrink-0 w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                <RiGiftLine className="w-5 h-5 text-primary" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground text-sm">You were referred! 🎉</p>
                <p className="text-xs text-muted-foreground">25% off your first cleaning is waiting for you.</p>
              </div>
            </div>
          )}

              {/* ZIP Code Form */}
              {formMode === 'zip' && (
                <form onSubmit={handleZipSubmit} className="space-y-4 animate-fade-in">
                  <div className="space-y-2">
                    <label htmlFor="zipCode" className="text-sm font-medium text-left block">
                      Your ZIP code
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
                      We check that we serve your area. It does not change the price.
                    </p>
                  </div>

                  <Button 
                    type="submit" 
                    size="lg" 
                    disabled={zipCode.length !== 5 || isValidating} 
                    className="w-full h-12 md:h-14 text-base md:text-lg font-semibold"
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
                        Enter your details and we will show the price for your home.
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
                    className="w-full h-12 md:h-14 text-base md:text-lg font-semibold"
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
                    <p className="text-sm font-medium text-foreground">What you get:</p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-center gap-2">
                        <RiCheckboxCircleLine className="w-4 h-4 text-primary" />
                        First to know when we launch in your area
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
                    className="w-full h-12 md:h-14 text-base md:text-lg font-semibold"
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
    </div>
  );
}
