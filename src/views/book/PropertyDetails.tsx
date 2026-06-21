"use client";
import {
  RiArrowRightLine,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiMapPinLine,
  RiSparklingLine
} from "@remixicon/react";
import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBooking } from "@/contexts/BookingContext";
import { AddressAutocomplete } from "@/components/booking/AddressAutocomplete";
import { SignaturePad } from "@/components/booking/SignaturePad";
import { SEO } from "@/components/SEO";
import { US_STATES, parseAddressString } from "@/lib/address-formatter";
import { lookupZip, stateFromZip } from "@/lib/zip-lookup";
import { buildSignedAgreementBase64 } from "@/lib/service-agreement";
import { format } from "date-fns";

// Customer-facing arrival windows. Mirrors the windows offered on
// /book/offer's SchedulePicker so the second-visit slot uses the same
// shape (id + label + start/end ISO times).
const ARRIVAL_WINDOWS = [
  { id: "8-12",  label: "8:00 AM – 12:00 PM", startHour: 8,  endHour: 12 },
  { id: "12-16", label: "12:00 PM – 4:00 PM", startHour: 12, endHour: 16 },
  { id: "16-20", label: "4:00 PM – 8:00 PM",  startHour: 16, endHour: 20 },
];

const DWELLING_TYPES = [
  { value: 'house', label: 'House' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'condo', label: 'Condo' },
  { value: 'office_space', label: 'Office Space' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'mansion', label: 'Mansion' },
];

const PETS_OPTIONS = [
  { value: 'none', label: 'No Pets' },
  { value: 'dog', label: 'Dog(s)' },
  { value: 'cat', label: 'Cat(s)' },
  { value: 'multiple', label: 'Multiple Pets' },
  { value: 'other', label: 'Other Pets' },
];

type BookingDetailsRow = {
  service_type: string | null;
  service_date: string | null;
  total_estimate_cents: number | null;
  deposit_cents: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  dwelling_type: string | null;
  flooring_type: string | null;
  pets: string | null;
  access_notes: string | null;
  second_visit_date: string | null;
  second_visit_time_slot: string | null;
  status: string | null;
  payment_intent_id: string | null;
};

const FLOORING_TYPES = [
  { value: 'hardwood', label: 'Hardwood' },
  { value: 'carpet', label: 'Carpet' },
  { value: 'tile', label: 'Tile' },
  { value: 'laminate', label: 'Laminate' },
  { value: 'vinyl', label: 'Vinyl/LVP' },
  { value: 'mixed', label: 'Mixed Flooring' },
  { value: 'other', label: 'Other' },
];

export default function PropertyDetails() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("booking_id");
  const { bookingData, updateBookingData } = useBooking();
  
  // Address fields. We pre-seed City / State / ZIP from BookingContext
  // so the customer doesn't have to re-type what they already gave us
  // on the ZIP step. State is auto-derived from the ZIP via the local
  // USPS prefix table the moment we have one — that way the field is
  // never blank for an MD/VA/PA/etc. customer who entered a ZIP on the
  // first step.
  const seededState =
    bookingData.state ||
    (bookingData.zipCode ? stateFromZip(bookingData.zipCode) : "") ||
    "MD";
  const [address, setAddress] = useState<string>("");
  const [city, setCity] = useState<string>(bookingData.city || "");
  const [state, setState] = useState<string>(seededState);
  const [zipCode, setZipCode] = useState<string>(bookingData.zipCode || "");
  // Cities returned by the Zippopotam.us lookup for the current ZIP.
  // When the list is non-empty we render City as a dropdown of those
  // candidates plus a "Type my own..." escape hatch; when empty we
  // fall back to a freeform Input so the user is never blocked.
  const [zipCities, setZipCities] = useState<string[]>([]);
  const [cityIsCustom, setCityIsCustom] = useState<boolean>(false);
  const [bedrooms, setBedrooms] = useState<string>("");
  const [bathrooms, setBathrooms] = useState<string>("");
  const [dwellingType, setDwellingType] = useState<string>("");
  const [flooringType, setFlooringType] = useState<string>("");
  const [pets, setPets] = useState<string>("none");
  const [accessNotes, setAccessNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Signed One-Time Service Agreement — captured here on the Details step
  // (moved off the Checkout page). The signature gates "Complete Booking".
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  // Authoritative figures + identity pulled from the booking row so the
  // generated agreement PDF maps the same totals the customer was charged.
  const [agreementMeta, setAgreementMeta] = useState<{
    totalCents: number;
    depositCents: number;
    firstName: string;
    lastName: string;
    email: string;
  }>({ totalCents: 0, depositCents: 0, firstName: "", lastName: "", email: "" });

  // Second-visit (Standard Clean follow-up) state — only used when the
  // booking is the Deep + Standard Combo offer. Defaulted to the first
  // valid follow-up date (deep + 7 days) on mount; the customer can
  // pick anything within +1 to +14 days of the deep clean.
  const [bookingMeta, setBookingMeta] = useState<{
    serviceType: string | null;
    serviceDate: string | null;
    isCombo: boolean;
  }>({ serviceType: null, serviceDate: null, isCombo: false });
  const [secondVisitDate, setSecondVisitDate] = useState<string>("");
  const [secondVisitSlot, setSecondVisitSlot] = useState<string>("");
  const [isHydrating, setIsHydrating] = useState(true);

  // Require a paid booking id (URL or context after Stripe redirect).
  // Guard with a ref so neither branch can fire more than once — without
  // this, a transient render where the URL param hasn't propagated yet could
  // bounce the page in a redirect loop.
  const didInitRedirect = useRef(false);
  useEffect(() => {
    const id = bookingId || bookingData.bookingId;
    if (id) {
      if (!bookingId && bookingData.bookingId && !didInitRedirect.current) {
        didInitRedirect.current = true;
        router.replace(`/book/details?booking_id=${bookingData.bookingId}`);
      }
      return;
    }
    if (didInitRedirect.current) return;
    didInitRedirect.current = true;
    toast.error("No booking ID found. Please complete checkout first.");
    router.replace("/book/checkout");
  }, [bookingId, bookingData.bookingId, router]);

  // Keep address chain in sync — if the context updates (e.g. user
  // bounces back to /book/zip and changes ZIP), reflect the new value
  // here unless the user has already typed over it.
  useEffect(() => {
    if (bookingData.zipCode && !zipCode) setZipCode(bookingData.zipCode);
    if (bookingData.city && !city) setCity(bookingData.city);
    if (bookingData.state && !state) setState(bookingData.state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingData.zipCode, bookingData.city, bookingData.state]);

  // Whenever the ZIP becomes a complete 5-digit value, run the lookup:
  //   • State is locked to the USPS-derived code instantly (offline),
  //     so customers in MD/VA/PA/etc. don't see the wrong default.
  //   • City list is fetched from the Zippopotam.us API. If we get one
  //     city back, auto-select it. If we get several, render the
  //     dropdown so the customer picks the right neighborhood/town.
  useEffect(() => {
    const digits = zipCode.replace(/\D/g, "");
    if (digits.length !== 5) return;

    const localState = stateFromZip(digits);
    if (localState && localState !== state) setState(localState);

    let cancelled = false;
    (async () => {
      const result = await lookupZip(digits);
      if (cancelled) return;
      if (result.state && result.state !== state) setState(result.state);
      setZipCities(result.cities);
      // If the customer hasn't yet picked a city or typed a custom one
      // AND the API returned exactly one candidate, auto-select it so
      // the form is one tap closer to "done". If they have multiple
      // matches we leave it for them to pick.
      if (!cityIsCustom && (!city || result.cities.includes(city))) {
        if (result.cities.length === 1) setCity(result.cities[0]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zipCode]);

  // Hydrate the form from the booking row (refresh-safe after payment).
  useEffect(() => {
    const id = bookingId || bookingData.bookingId;
    if (!id) return;
    let cancelled = false;
    (async () => {
      const { data: raw, error } = await supabase
        .from("bookings")
        .select(
          "service_type, service_date, total_estimate_cents, deposit_cents, first_name, last_name, email, address, city, state, zip_code, bedrooms, bathrooms, dwelling_type, flooring_type, pets, access_notes, second_visit_date, second_visit_time_slot, status, payment_intent_id",
        )
        .eq("id", id)
        .maybeSingle();
      const data = raw as unknown as BookingDetailsRow | null;
      if (cancelled) return;
      if (error || !data) {
        setIsHydrating(false);
        toast.error("Could not load your booking. Please return to checkout.");
        router.replace("/book/checkout");
        return;
      }

      // Only block when checkout was never started (no Stripe PI on file).
      const paidOrInProgress =
        data.payment_intent_id ||
        data.status === "pending_details" ||
        data.status === "confirmed" ||
        data.status === "booked" ||
        data.status === "assigned";
      if (data.status === "pending_payment" && !paidOrInProgress) {
        setIsHydrating(false);
        toast.info("Complete your deposit on checkout before adding home details.");
        router.replace("/book/checkout");
        return;
      }

      const isCombo = data.service_type === "combo";
      setBookingMeta({
        serviceType: data.service_type,
        serviceDate: data.service_date,
        isCombo,
      });
      setAgreementMeta({
        totalCents: Number(data.total_estimate_cents || 0),
        depositCents: Number(data.deposit_cents || 0),
        firstName: data.first_name || "",
        lastName: data.last_name || "",
        email: data.email || "",
      });

      if (data.address) setAddress(data.address);
      else if (bookingData.address) setAddress(bookingData.address);
      if (data.city) setCity(data.city);
      else if (bookingData.city) setCity(bookingData.city);
      if (data.state) setState(data.state);
      else if (bookingData.state) setState(bookingData.state);
      if (data.zip_code) setZipCode(data.zip_code);
      else if (bookingData.zipCode) setZipCode(bookingData.zipCode);
      if (data.bedrooms != null) setBedrooms(String(data.bedrooms));
      if (data.bathrooms != null) setBathrooms(String(data.bathrooms));
      if (data.dwelling_type) setDwellingType(data.dwelling_type);
      if (data.flooring_type) setFlooringType(data.flooring_type);
      if (data.pets) setPets(data.pets);
      if (data.access_notes) setAccessNotes(data.access_notes);

      if (data.second_visit_date) setSecondVisitDate(data.second_visit_date);
      else if (isCombo && data.service_date) {
        const d = new Date(`${data.service_date}T12:00:00`);
        d.setDate(d.getDate() + 7);
        setSecondVisitDate(d.toISOString().slice(0, 10));
      }
      if (data.second_visit_time_slot) setSecondVisitSlot(data.second_visit_time_slot);

      setIsHydrating(false);
    })().catch(() => {
      if (!cancelled) setIsHydrating(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, bookingData.bookingId]);

  // Compute the allowed +1..+14 day range for the follow-up Standard.
  const secondVisitMin = bookingMeta.serviceDate ? (() => {
    const d = new Date(`${bookingMeta.serviceDate}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })() : "";
  const secondVisitMax = bookingMeta.serviceDate ? (() => {
    const d = new Date(`${bookingMeta.serviceDate}T12:00:00`);
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  })() : "";

  const handleAddressSelect = (addr: { street: string; city: string; state: string; zipCode: string; lat?: number; lng?: number }) => {
    // Defensive parse: if the autocomplete returned a "Street" that
    // really contains the full address (e.g. user typed it all), split
    // out the city/state/zip before we drop it into the Street field.
    let street = addr.street || "";
    let nextCity = addr.city || "";
    let nextState = addr.state || "";
    let nextZip = addr.zipCode || "";

    if (!nextCity || !nextState || !nextZip) {
      const parsed = parseAddressString(street);
      if (parsed.street) street = parsed.street;
      if (!nextCity) nextCity = parsed.city;
      if (!nextState) nextState = parsed.state;
      if (!nextZip) nextZip = parsed.zipCode;
    }

    setAddress(street);
    if (nextCity) setCity(nextCity);
    if (nextState) setState(nextState);
    if (nextZip) setZipCode(nextZip);
    updateBookingData({
      address: street,
      city: nextCity || city,
      state: nextState || state,
      zipCode: nextZip || zipCode,
    });
  };

  // Human-readable service label for the agreement PDF.
  const serviceLabel = (() => {
    switch (bookingMeta.serviceType) {
      case "combo": return "Deep + Standard Combo";
      case "deep": return "Deep Clean";
      case "standard": return "Standard Clean";
      default: return bookingMeta.serviceType || "Cleaning";
    }
  })();

  // Build the signed One-Time Service Agreement in-browser and hand it to
  // store-service-agreement (stores PDF + records acceptance + emails the
  // customer). Fire-and-forget so navigation to confirmation never blocks
  // on the PDF build / Edge Function cold-start.
  const persistServiceAgreement = async () => {
    const id = bookingId || bookingData.bookingId;
    if (!signatureDataUrl || !id) return;
    try {
      const fullName =
        `${bookingData.firstName || agreementMeta.firstName || ""} ${bookingData.lastName || agreementMeta.lastName || ""}`.trim() ||
        bookingData.email ||
        agreementMeta.email ||
        "";
      const email = bookingData.email || agreementMeta.email || "";
      const total = agreementMeta.totalCents || undefined;
      const deposit = agreementMeta.depositCents || undefined;
      const balance =
        total != null && deposit != null ? Math.max(0, total - deposit) : undefined;
      const pdfBase64 = await buildSignedAgreementBase64({
        name: fullName,
        email,
        serviceType: serviceLabel,
        serviceDate: bookingMeta.serviceDate
          ? format(new Date(`${bookingMeta.serviceDate}T12:00:00`), "EEEE, MMM d, yyyy")
          : undefined,
        totalCents: total,
        depositCents: deposit,
        balanceCents: balance,
        signatureDataUrl,
      });
      await supabase.functions.invoke("store-service-agreement", {
        body: {
          bookingId: id,
          email,
          name: fullName,
          serviceType: serviceLabel,
          source: "details",
          // Policies are presented for review on the checkout step and the
          // customer accepts them by signing here, so each is recorded true.
          agreed: { terms: true, disclaimer: true, refund: true, serviceAgreement: true },
          pdfBase64,
        },
      });
    } catch (err) {
      console.error("[PropertyDetails] service agreement store failed", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Street uses an uncontrolled input when Google Places is active —
    // read the live DOM value so manual typing still submits.
    const streetInput = document.getElementById("customer-address-autocomplete") as HTMLInputElement | null;
    const street = (address || streetInput?.value || "").trim();
    if (street && street !== address) setAddress(street);

    if (!street || !city || !state || !bedrooms || !bathrooms || !dwellingType) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (!signatureDataUrl) {
      toast.error("Please sign the One-Time Service Agreement to complete your booking");
      return;
    }

    // Combo bookings require the second-visit date + arrival window.
    if (bookingMeta.isCombo && (!secondVisitDate || !secondVisitSlot)) {
      toast.error("Please pick a date and arrival window for your follow-up Standard Clean");
      return;
    }

    // Validate the second-visit date sits within +1..+14 days of the
    // first visit (defense-in-depth against a tampered date input).
    if (bookingMeta.isCombo && secondVisitDate && bookingMeta.serviceDate) {
      const first = new Date(`${bookingMeta.serviceDate}T12:00:00`);
      const second = new Date(`${secondVisitDate}T12:00:00`);
      const days = Math.round((second.getTime() - first.getTime()) / 86400000);
      if (days < 1 || days > 14) {
        toast.error("Follow-up Standard Clean must be 1–14 days after your Deep Clean");
        return;
      }
    }

    const id = bookingId || bookingData.bookingId;
    if (!id) {
      toast.error("Invalid booking");
      return;
    }

    setIsSubmitting(true);

    try {
      // Build second-visit ISO start/end so dispatch + availability
      // tooling can use the same shape as the first visit.
      const secondVisitFields: Record<string, unknown> = {};
      if (bookingMeta.isCombo && secondVisitDate && secondVisitSlot) {
        const window = ARRIVAL_WINDOWS.find((w) => w.id === secondVisitSlot);
        if (window) {
          const pad = (n: number) => String(n).padStart(2, "0");
          secondVisitFields.second_visit_date = secondVisitDate;
          secondVisitFields.second_visit_time_slot = secondVisitSlot;
          secondVisitFields.second_visit_start_time = `${secondVisitDate}T${pad(window.startHour)}:00:00`;
          secondVisitFields.second_visit_end_time = `${secondVisitDate}T${pad(window.endHour)}:00:00`;
        }
      }

      const { error } = await supabase
        .from("bookings")
        .update({
          address: street,
          city,
          state,
          zip_code: zipCode || bookingData.zipCode,
          bedrooms: parseInt(bedrooms),
          bathrooms: parseFloat(bathrooms),
          dwelling_type: dwellingType,
          flooring_type: flooringType || null,
          pets,
          access_notes: accessNotes || null,
          // Stamp the offer-type column too so reports / GHL syncs can
          // distinguish combo bookings from standalone deep / standard.
          ...(bookingMeta.serviceType ? { offer_type: bookingMeta.serviceType } : {}),
          ...secondVisitFields,
        })
        .eq("id", id);

      if (error) throw error;

      // Mirror the freshly-saved fields into the BookingContext so the
      // confirmation page shows the right address immediately (instead
      // of having to wait for the DB hydration round-trip on /book/
      // confirmation). The Success page also re-hydrates from the row
      // as a safety net for deep-linked landings.
      updateBookingData({
        address: street,
        city,
        state,
        zipCode: zipCode || bookingData.zipCode,
        bedrooms: parseInt(bedrooms),
        bathrooms: parseFloat(bathrooms),
        dwellingType,
      });

      // Kick finalize-booking FIRE-AND-FORGET so navigation never
      // blocks on a cold-start Edge Function. Previously we awaited
      // this call which sometimes caused the browser to send the
      // CORS preflight but never the POST (the user navigated before
      // the function responded). finalize-booking is idempotent and a
      // backstop DB trigger + the confirmation page's polling + cron
      // all converge on the same end state, so it's safe to not block.
      supabase.functions.invoke("finalize-booking", {
        body: { bookingId: id, trigger: "property_details_save" },
      }).catch((finalizeErr) => {
        console.warn("[PropertyDetails] finalize-booking invoke failed (non-blocking)", finalizeErr);
      });

      // Generate + store the signed One-Time Service Agreement (and email a
      // copy). Fire-and-forget so confirmation navigation isn't blocked.
      void persistServiceAgreement();

      toast.success("Details saved! Finalizing your booking…");
      router.push(`/book/confirmation?booking_id=${id}`);
    } catch (error: unknown) {
      console.error("Error saving details:", error);
      const msg =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: string }).message)
          : "Failed to save details. Please try again.";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero px-3 md:px-4 py-8 md:py-12 flex items-center justify-center">
      <SEO title="Property Details" description="Provide details about your home for a customized cleaning experience." noindex />
      <Card variant="outlined" className="max-w-lg w-full shadow-card animate-fade-in overflow-visible">
        {/* Brand gradient strip — visually ties the details step to the
            rest of the funnel (zip → offer → checkout → THIS → confirm). */}
        <div className="h-1.5 w-full" style={{ background: 'var(--gradient-primary)' }} />

        {/* 5-step funnel progress indicator — gives the customer a clear
            sense of "almost done" and reduces drop-off on this screen. */}
        <div className="px-5 md:px-6 pt-5">
          <div className="flex items-center justify-between gap-2 mb-1">
            {[
              { id: 'zip', label: 'ZIP' },
              { id: 'offer', label: 'Offer' },
              { id: 'pay', label: 'Pay' },
              { id: 'details', label: 'Details' },
              { id: 'done', label: 'Confirm' },
            ].map((step, idx) => {
              const isCurrent = step.id === 'details';
              const isComplete = idx < 3; // zip / offer / pay already done by definition
              return (
                <div key={step.id} className="flex-1 flex flex-col items-center gap-1">
                  <div className={`w-full h-1 rounded-full ${
                    isComplete ? 'bg-primary' :
                    isCurrent ? 'bg-gradient-to-r from-primary to-primary/40' :
                    'bg-muted'
                  }`} />
                  <span className={`text-[10px] uppercase tracking-wider ${
                    isCurrent ? 'text-primary font-semibold' :
                    isComplete ? 'text-foreground/70' :
                    'text-muted-foreground'
                  }`}>{step.label}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-1">Step 4 of 5 — almost done</p>
        </div>

        <CardHeader className="text-center space-y-3 pb-4 pt-4">
          <div className="mx-auto w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center shadow-sm">
            <RiCheckboxCircleLine className="w-7 h-7 text-primary" />
          </div>
          <CardTitle className="text-lg md:text-xl font-semibold tracking-tight">Tell us about your home</CardTitle>
          <CardDescription className="text-sm max-w-sm mx-auto">
            Your payment is held. Add a few quick details and we'll lock in your booking — usually under 60 seconds.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Service Address */}
            <div className="space-y-4">
              <h3 className="text-base md:text-lg font-semibold">Service Address</h3>
              
              <AddressAutocomplete
                key="details-address"
                label="Street Address *"
                placeholder="Start typing your address..."
                initialValue={address}
                onAddressSelect={handleAddressSelect}
              />
              {isHydrating && (
                <p className="text-xs text-muted-foreground">Loading your booking…</p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">
                    City <span className="text-destructive">*</span>
                  </Label>
                  {zipCities.length > 0 && !cityIsCustom ? (
                    <Select
                      value={zipCities.includes(city) ? city : ""}
                      onValueChange={(v) => {
                        if (v === "__custom__") {
                          setCityIsCustom(true);
                          setCity("");
                        } else {
                          setCity(v);
                        }
                      }}
                    >
                      <SelectTrigger id="city" className="h-12">
                        <SelectValue placeholder={`Select city for ${zipCode}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {zipCities.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                        <SelectItem value="__custom__">Type my own…</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="h-12"
                      placeholder={zipCode ? `City for ${zipCode}` : "City"}
                      required
                    />
                  )}
                  {zipCities.length > 0 && cityIsCustom && (
                    <button
                      type="button"
                      onClick={() => { setCityIsCustom(false); setCity(zipCities[0] || ""); }}
                      className="text-[11px] text-primary underline underline-offset-2 hover:opacity-80"
                    >
                      ← Pick from {zipCities.length} known {zipCities.length === 1 ? "city" : "cities"} for {zipCode}
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="state">
                    State <span className="text-destructive">*</span>
                  </Label>
                  <Select value={state} onValueChange={setState}>
                    <SelectTrigger id="state" className="h-12">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {US_STATES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.value} — {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="zip">ZIP Code</Label>
                  <Input
                    id="zip"
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value)}
                    className="h-12"
                    placeholder="12345"
                  />
                </div>
              </div>
            </div>

            {/* Property Details */}
            <div className="space-y-4 border-t pt-6">
              <h3 className="text-base md:text-lg font-semibold">Property Information</h3>
            
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bedrooms">
                    Bedrooms <span className="text-destructive">*</span>
                  </Label>
                  <Select value={bedrooms} onValueChange={setBedrooms}>
                    <SelectTrigger id="bedrooms" className="h-12">
                      <SelectValue placeholder="Select bedrooms" />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                        <SelectItem key={num} value={num.toString()}>
                          {num} {num === 1 ? 'bedroom' : 'bedrooms'}
                        </SelectItem>
                      ))}
                      <SelectItem value="10+">10+ bedrooms</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bathrooms">
                    Bathrooms <span className="text-destructive">*</span>
                  </Label>
                  <Select value={bathrooms} onValueChange={setBathrooms}>
                    <SelectTrigger id="bathrooms" className="h-12">
                      <SelectValue placeholder="Select bathrooms" />
                    </SelectTrigger>
                    <SelectContent>
                      {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((num) => (
                        <SelectItem key={num} value={num.toString()}>
                          {num} {num === 1 ? 'bathroom' : 'bathrooms'}
                        </SelectItem>
                      ))}
                      <SelectItem value="5+">5+ bathrooms</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="dwellingType">
                  Dwelling Type <span className="text-destructive">*</span>
                </Label>
                <Select value={dwellingType} onValueChange={setDwellingType}>
                  <SelectTrigger id="dwellingType" className="h-12">
                    <SelectValue placeholder="Select dwelling type" />
                  </SelectTrigger>
                  <SelectContent>
                    {DWELLING_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="flooringType">
                  Primary Flooring Type
                </Label>
                <Select value={flooringType} onValueChange={setFlooringType}>
                  <SelectTrigger id="flooringType" className="h-12">
                    <SelectValue placeholder="Select flooring type" />
                  </SelectTrigger>
                  <SelectContent>
                    {FLOORING_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pets">
                  Pets at Property <span className="text-destructive">*</span>
                </Label>
                <Select value={pets} onValueChange={setPets}>
                  <SelectTrigger id="pets" className="h-12">
                    <SelectValue placeholder="Select pets" />
                  </SelectTrigger>
                  <SelectContent>
                    {PETS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Combo bookings — schedule the follow-up Standard Clean */}
              {bookingMeta.isCombo && (
                <div className="space-y-3 border-t pt-6">
                  <div className="flex items-center gap-2">
                    <RiSparklingLine className="w-5 h-5 text-primary" />
                    <h3 className="text-base md:text-lg font-semibold">
                      Schedule Your Follow-Up Standard Clean
                    </h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your combo includes a Standard Clean within 14 days of your Deep Clean
                    {bookingMeta.serviceDate ? ` on ${bookingMeta.serviceDate}` : ""}.
                    Pick the date and arrival window that works for you.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="secondVisitDate">
                        Standard Clean date <span className="text-destructive">*</span>
                      </Label>
                      <div className="relative">
                        <RiCalendarLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                        <Input
                          id="secondVisitDate"
                          type="date"
                          value={secondVisitDate}
                          min={secondVisitMin}
                          max={secondVisitMax}
                          onChange={(e) => setSecondVisitDate(e.target.value)}
                          className="h-12 pl-9"
                          required
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Allowed range: {secondVisitMin || "—"} → {secondVisitMax || "—"}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="secondVisitSlot">
                        Arrival window <span className="text-destructive">*</span>
                      </Label>
                      <Select value={secondVisitSlot} onValueChange={setSecondVisitSlot}>
                        <SelectTrigger id="secondVisitSlot" className="h-12">
                          <SelectValue placeholder="Select an arrival window" />
                        </SelectTrigger>
                        <SelectContent>
                          {ARRIVAL_WINDOWS.map((w) => (
                            <SelectItem key={w.id} value={w.id}>{w.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="accessNotes">
                  Access Notes
                </Label>
                <Textarea
                  id="accessNotes"
                  value={accessNotes}
                  onChange={(e) => setAccessNotes(e.target.value)}
                  placeholder="Gate code, key location, parking instructions, or any special entry instructions..."
                  className="min-h-[80px] resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Optional: Provide entry instructions for our cleaning team
                </p>
              </div>
            </div>

            {/* Sign Your Service Agreement — moved here from the Checkout
                step. Customer reviews the policies on checkout, then signs
                the One-Time Service Agreement here to finalize the booking. */}
            <div className="space-y-4 border-t pt-6">
              <div className="flex items-center gap-2">
                <RiSparklingLine className="w-5 h-5 text-primary" />
                <h3 className="text-base md:text-lg font-semibold">Sign Your Service Agreement</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                By signing you agree to the{" "}
                <a href="https://novaracleaning.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">Terms of Service</a>,{" "}
                <a href="https://novaracleaning.com/disclaimer" target="_blank" rel="noopener noreferrer" className="text-primary underline">Disclaimer</a>,{" "}
                <a href="https://novaracleaning.com/refund-policy" target="_blank" rel="noopener noreferrer" className="text-primary underline">Refund Policy</a>, and the{" "}
                <a href="/agreements/one-time-service-agreement.pdf" target="_blank" rel="noopener noreferrer" className="text-primary underline">One-Time Service Agreement</a>. A signed copy is emailed to you.
              </p>
              <div className="space-y-1.5">
                <Label>
                  Your signature <span className="text-destructive">*</span>
                </Label>
                <SignaturePad onChange={setSignatureDataUrl} />
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting || isHydrating || !city || !state || !bedrooms || !bathrooms || !dwellingType || !signatureDataUrl}
              className="w-full h-12 md:h-14 text-base font-semibold"
            >
              {isSubmitting ? "Saving..." : "Complete Booking"}
              <RiArrowRightLine className="ml-2 w-5 h-5" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
