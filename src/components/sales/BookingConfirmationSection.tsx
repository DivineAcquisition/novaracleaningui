import { useState } from "react";
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
import { CheckCircle, Calendar, MapPin, CreditCard, Clock, AlertTriangle, Loader2 } from "lucide-react";
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
}

const STATUS_OPTIONS = [
  { value: "booked", label: "Booked", color: "bg-emerald-500/20 text-emerald-400" },
  { value: "follow_up", label: "Follow-Up Needed", color: "bg-amber-500/20 text-amber-400" },
  { value: "lost", label: "Lost / Not Interested", color: "bg-red-500/20 text-red-400" },
  { value: "outside_area", label: "Outside Service Area", color: "bg-slate-500/20 text-slate-400" },
];

const PAYMENT_METHODS = ["Card", "Cash", "ACH", "Other"];

export function BookingConfirmationSection({
  leadId,
  lead,
  qualification,
  isNewCustomer,
  onBooked,
}: BookingConfirmationProps) {
  const [status, setStatus] = useState("booked");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("MD");
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
    
    // Fire confirmation email
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

    // Fire GHL/Zapier webhook
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

    // Fire Google Calendar event
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
      // Update lead status
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
        // Create actual booking in bookings table
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

        // Fire post-booking side effects (non-blocking)
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
        <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-white">
          {status === "booked" ? "Booking Confirmed!" : "Lead Updated"}
        </h3>
        <p className="text-sm text-slate-400 mt-1">
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
        <CheckCircle className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-semibold text-white">Close & Confirm</h2>
      </div>

      {/* Status Selection */}
      <div className="space-y-3">
        <Label className="text-slate-300">Outcome</Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatus(opt.value)}
              className={cn(
                "p-3 rounded-lg border text-center transition-all text-sm font-medium",
                status === opt.value
                  ? `border-amber-500 ${opt.color}`
                  : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {status === "booked" && (
        <>
          <Separator className="bg-slate-700" />

          {/* Address */}
          <div className="space-y-4">
            <Label className="text-slate-300 flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Service Address
            </Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-3">
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street address"
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
                className="bg-slate-800 border-slate-700 text-white"
              />
              <Input
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="State"
                className="bg-slate-800 border-slate-700 text-white"
              />
              <Input
                value={qualification.zipCode}
                disabled
                className="bg-slate-800/50 border-slate-700 text-slate-400"
              />
            </div>
          </div>

          {/* Confirmed Date/Time */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300 flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Confirmed Date
              </Label>
              <Input
                type="date"
                value={qualification.preferredDate}
                disabled
                className="bg-slate-800/50 border-slate-700 text-slate-300"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Time Window
              </Label>
              <Input
                value={qualification.preferredTime || "TBD"}
                disabled
                className="bg-slate-800/50 border-slate-700 text-slate-300"
              />
            </div>
          </div>

          {/* Payment */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300 flex items-center gap-2">
                <CreditCard className="w-4 h-4" /> Payment Method
              </Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
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
              <Label className="text-slate-300">Deposit collected ({formatCents(quote.depositCents)})</Label>
            </div>
          </div>

          {!depositCollected && (
            <div className="flex items-center gap-2 text-amber-400 text-sm bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Booking will be saved as "Pending Payment" until deposit is collected.
            </div>
          )}

          {/* Access Notes */}
          <div className="space-y-2">
            <Label className="text-slate-300">Access Instructions</Label>
            <Textarea
              value={accessNotes}
              onChange={(e) => setAccessNotes(e.target.value)}
              placeholder="Gate codes, key location, parking instructions..."
              className="bg-slate-800 border-slate-700 text-white min-h-[60px]"
            />
          </div>

          {/* Summary */}
          <div className="bg-slate-800/50 rounded-lg p-4 space-y-2 text-sm">
            <div className="font-semibold text-white mb-2">Booking Summary</div>
            <div className="flex justify-between text-slate-300">
              <span>Service</span><span>{serviceName}</span>
            </div>
            <div className="flex justify-between text-slate-300">
              <span>Per Clean</span><span className="font-semibold text-white">{formatCents(quote.perCleanCents)}</span>
            </div>
            <div className="flex justify-between text-amber-400">
              <span>Deposit</span><span>{formatCents(quote.depositCents)}</span>
            </div>
            <div className="flex justify-between text-slate-300">
              <span>Balance After</span><span>{formatCents(quote.balanceDueCents)}</span>
            </div>
          </div>
        </>
      )}

      <Button
        onClick={handleConfirmBooking}
        disabled={confirming}
        className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold h-12"
      >
        {confirming ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
        ) : status === "booked" ? (
          <><CheckCircle className="w-4 h-4 mr-2" /> Confirm Booking</>
        ) : (
          <><CheckCircle className="w-4 h-4 mr-2" /> Update Status</>
        )}
      </Button>
    </div>
  );
}
