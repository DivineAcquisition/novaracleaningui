"use client";

import {
  RiAlertLine,
  RiBankCardLine,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiLoader4Line,
  RiMapPinLine,
  RiTimeLine
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { calculateQuote, formatCents } from "@/lib/sales-pricing";
import { SERVICE_TIERS } from "@/config/brand-config";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

interface BookingConfirmationProps {
  leadId: string | null;
  lead: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    activeChannel: string;
  };
  qualification: {
    serviceType: string;
    homeSizeId: string;
    frequency: string;
    addOns: string[];
    zipCode: string;
    bedrooms: number;
    bathrooms: number;
    preferredDate: string;
    preferredTime: string;
    specialRequests: string;
  };
  isNewCustomer: boolean;
  onBooked: () => void;
  coverageCity?: string;
  coverageState?: string;
}

const STATUS_OPTIONS = [
  { value: "booked", label: "Booked", color: "bg-emerald-500/20 text-emerald-600" },
  { value: "follow_up", label: "Follow-Up Needed", color: "bg-amber-500/20 text-amber-600" },
  { value: "lost", label: "Lost / Not Interested", color: "bg-red-500/20 text-red-600" },
  { value: "outside_area", label: "Outside Service Area", color: "bg-gray-100 text-gray-500" },
];

const PAYMENT_METHODS = ["Card", "Cash", "ACH", "Other"];

export function BookingConfirmationSection({
  leadId,
  lead,
  qualification,
  isNewCustomer,
  onBooked,
  coverageCity,
  coverageState,
}: BookingConfirmationProps) {
  const [status, setStatus] = useState("booked");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState(coverageCity || "");
  const [state, setState] = useState(coverageState || "MD");

  useEffect(() => {
    if (coverageCity && !city) setCity(coverageCity);
    if (coverageState) setState(coverageState);
  }, [coverageCity, coverageState]);
  const [accessNotes, setAccessNotes] = useState(qualification.specialRequests || "");
  const [paymentMethod, setPaymentMethod] = useState("Card");
  const [depositCollected, setDepositCollected] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const quote = calculateQuote({
    homeSizeId: qualification.homeSizeId,
    serviceType: qualification.serviceType,
    frequency: qualification.frequency,
    addOnIds: qualification.addOns,
    isNewCustomer,
  });

  const serviceName = SERVICE_TIERS.find((t) => t.id === qualification.serviceType)?.name || "Standard Clean";

  const triggerPostBookingActions = async (bookingData: any) => {
    const fullAddress = `${address}, ${city}, ${state} ${qualification.zipCode}`;
    
    try {
      await supabase.functions.invoke("send-booking-email", {
        body: {
          type: "confirmation",
          email: lead.email,
          data: {
            firstName: lead.firstName,
            lastName: lead.lastName,
            bookingId: bookingData?.id,
            serviceDate: qualification.preferredDate,
            timeSlot: qualification.preferredTime || "Morning (8am-12pm)",
            serviceType: qualification.serviceType,
            homeSizeId: qualification.homeSizeId,
            bedrooms: qualification.bedrooms,
            bathrooms: qualification.bathrooms,
            address: fullAddress,
            city,
            state,
            zipCode: qualification.zipCode,
            totalAmount: quote.finalPriceCents,
            depositAmount: quote.depositCents,
            balanceAmount: quote.balanceDueCents,
            frequency: qualification.frequency,
            addOns: qualification.addOns,
            paymentMethod,
          },
        },
      });
      console.log("[BookingConfirmation] Confirmation email sent");
    } catch (err) {
      console.error("[BookingConfirmation] Email failed:", err);
    }

    try {
      await supabase.functions.invoke("send-lead-capture-webhook", {
        body: {
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          zipCode: qualification.zipCode,
          city,
          state,
          source: "Sales Tool - Booking Confirmed",
        },
      });
      console.log("[BookingConfirmation] Webhook sent");
    } catch (err) {
      console.error("[BookingConfirmation] Webhook failed:", err);
    }

    try {
      await supabase.functions.invoke("create-google-calendar-event", {
        body: {
          bookingId: bookingData?.id,
          serviceDate: qualification.preferredDate,
          timeSlot: qualification.preferredTime || "Morning (8am-12pm)",
          serviceType: serviceName,
          address: fullAddress,
          customerName: `${lead.firstName} ${lead.lastName}`,
          customerPhone: lead.phone,
          customerEmail: lead.email,
        },
      });
      console.log("[BookingConfirmation] Calendar event created");
    } catch (err) {
      console.error("[BookingConfirmation] Calendar failed:", err);
    }
  };

  const handleConfirmBooking = async () => {
    if (status === "booked") {
      if (!address || !city || !qualification.preferredDate) {
        toast.error("Address and date are required for booking");
        return;
      }
    }

    setConfirming(true);
    try {
      if (leadId) {
        await supabase.from("leads").update({
          status,
        } as any).eq("id", leadId);

        await supabase.from("lead_activity_log").insert({
          lead_id: leadId,
          action: status === "booked" ? "booked" : status === "follow_up" ? "follow_up_needed" : "lost",
          notes: status === "booked" ? `Booking confirmed for ${qualification.preferredDate}` : `Status set to ${status}`,
        } as any);
      }

      if (status === "booked") {
        const fullAddress = `${address}, ${city}, ${state} ${qualification.zipCode}`;
        const { data: bookingData, error: bookingError } = await supabase.from("bookings").insert({
          first_name: lead.firstName,
          last_name: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          address: fullAddress,
          city,
          state,
          zip_code: qualification.zipCode,
          home_size_id: qualification.homeSizeId,
          service_type: qualification.serviceType,
          service_date: qualification.preferredDate,
          time_slot: qualification.preferredTime || "Morning (8am-12pm)",
          add_ons: qualification.addOns,
          frequency: qualification.frequency,
          base_price_cents: quote.basePriceCents + quote.serviceTierCost,
          deposit_cents: quote.depositCents,
          total_estimate_cents: quote.finalPriceCents,
          payment_method: paymentMethod,
          access_notes: accessNotes || null,
          booking_channel: "Phone/CSR",
          booker_source: "Sales Tool",
          status: depositCollected ? "confirmed" : "pending_payment",
          bedrooms: qualification.bedrooms || null,
          bathrooms: qualification.bathrooms || null,
        }).select().single();

        if (bookingError) throw bookingError;

        triggerPostBookingActions(bookingData).catch(console.error);

        toast.success("Booking confirmed and saved!");
      } else {
        toast.success(`Lead status updated to: ${STATUS_OPTIONS.find((s) => s.value === status)?.label}`);
      }

      setConfirmed(true);
      onBooked();
    } catch (err: any) {
      toast.error("Failed: " + err.message);
    } finally {
      setConfirming(false);
    }
  };

  if (confirmed) {
    return (
      <div className="text-center py-8">
        <RiCheckboxCircleLine className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-gray-900">
          {status === "booked" ? "Booking Confirmed!" : "Lead Updated"}
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          {status === "booked"
            ? `${serviceName} for ${lead.firstName} on ${qualification.preferredDate}`
            : `Status: ${STATUS_OPTIONS.find((s) => s.value === status)?.label}`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <RiCheckboxCircleLine className="w-5 h-5 text-emerald-600" />
        <h2 className="text-lg font-semibold text-gray-900">Close & Confirm</h2>
      </div>

      {/* Status Selection */}
      <div className="space-y-3">
        <Label className="text-gray-600">Outcome</Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatus(opt.value)}
              className={cn(
                "p-3 rounded-lg border text-center transition-all text-sm font-medium",
                status === opt.value
                  ? `border-emerald-500 ${opt.color}`
                  : "border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-400"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {status === "booked" && (
        <>
          <Separator className="bg-gray-200" />

          {/* Address */}
          <div className="space-y-4">
            <Label className="text-gray-600 flex items-center gap-2">
              <RiMapPinLine className="w-4 h-4" /> Service Address
            </Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-3">
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street address"
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
                className="bg-white border-gray-300 text-gray-900"
              />
              <Input
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="State"
                className="bg-white border-gray-300 text-gray-900"
              />
              <Input
                value={qualification.zipCode}
                disabled
                className="bg-gray-50 border-gray-300 text-gray-500"
              />
            </div>
          </div>

          {/* Confirmed Date/Time */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-gray-600 flex items-center gap-2">
                <RiCalendarLine className="w-4 h-4" /> Confirmed Date
              </Label>
              <Input
                type="date"
                value={qualification.preferredDate}
                disabled
                className="bg-gray-50 border-gray-300 text-gray-600"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-600 flex items-center gap-2">
                <RiTimeLine className="w-4 h-4" /> Time Window
              </Label>
              <Input
                value={qualification.preferredTime || "TBD"}
                disabled
                className="bg-gray-50 border-gray-300 text-gray-600"
              />
            </div>
          </div>

          {/* Payment */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-gray-600 flex items-center gap-2">
                <RiBankCardLine className="w-4 h-4" /> Payment Method
              </Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch checked={depositCollected} onCheckedChange={setDepositCollected} />
              <Label className="text-gray-600">Deposit collected ({formatCents(quote.depositCents)})</Label>
            </div>
          </div>

          {!depositCollected && (
            <div className="flex items-center gap-2 text-amber-600 text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <RiAlertLine className="w-4 h-4 shrink-0" />
              Booking will be saved as "Pending Payment" until deposit is collected.
            </div>
          )}

          {/* Access Notes */}
          <div className="space-y-2">
            <Label className="text-gray-600">Access Instructions</Label>
            <Textarea
              value={accessNotes}
              onChange={(e) => setAccessNotes(e.target.value)}
              placeholder="Gate codes, key location, parking instructions..."
              className="bg-white border-gray-300 text-gray-900 min-h-[60px]"
            />
          </div>

          {/* Summary */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
            <div className="font-semibold text-gray-900 mb-2">Booking Summary</div>
            <div className="flex justify-between text-gray-600">
              <span>Service</span><span>{serviceName}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Per Clean</span><span className="font-semibold text-gray-900">{formatCents(quote.perCleanCents)}</span>
            </div>
            <div className="flex justify-between text-emerald-600">
              <span>Deposit</span><span>{formatCents(quote.depositCents)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Balance After</span><span>{formatCents(quote.balanceDueCents)}</span>
            </div>
          </div>
        </>
      )}

      <Button
        onClick={handleConfirmBooking}
        disabled={confirming}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold h-12"
      >
        {confirming ? (
          <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
        ) : status === "booked" ? (
          <><RiCheckboxCircleLine className="w-4 h-4 mr-2" /> Confirm Booking</>
        ) : (
          <><RiCheckboxCircleLine className="w-4 h-4 mr-2" /> Update Status</>
        )}
      </Button>
    </div>
  );
}
