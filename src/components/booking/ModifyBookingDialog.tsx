"use client";

import {
  RiAddLine,
  RiBox3Line,
  RiCheckLine,
  RiErrorWarningLine,
  RiFlashlightLine,
  RiHome4Line,
  RiHotelBedLine,
  RiInformationLine,
  RiLoader4Line,
  RiSparklingLine,
  RiSubtractLine,
} from "@remixicon/react";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ResponsiveModal } from "@/components/booking/ResponsiveModal";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { calculatePrice, ADD_ONS, OPS_ONLY_ADD_ON_IDS } from "@/lib/pricing-system";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface Booking {
  id: string;
  service_type: string;
  add_ons: string[];
  home_size_id: string;
  bedrooms: number | null;
  bathrooms: number | null;
  dwelling_type: string | null;
  membership_plan: string;
  uses_credit: boolean;
  total_estimate_cents: number;
  service_date: string;
}

interface ModifyBookingDialogProps {
  booking: Booking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// Compact, visual service tier picker. Cards use icon + name and stay
// scannable at mobile widths.
const SERVICES = [
  {
    id: "standard",
    icon: RiSparklingLine,
    name: "Standard",
    blurb: "Routine upkeep — same tier as your usual visit.",
    accent: "from-sky-500/20 to-sky-500/5 border-sky-200",
  },
  {
    id: "deep",
    icon: RiFlashlightLine,
    name: "Deep Clean",
    blurb: "Heavy refresh — adds baseboards, vents, detail work.",
    accent: "from-amber-500/20 to-amber-500/5 border-amber-200",
  },
  {
    id: "moveInOut",
    icon: RiBox3Line,
    name: "Move-In/Out",
    blurb: "Top-to-bottom + inside fridge & oven included.",
    accent: "from-violet-500/20 to-violet-500/5 border-violet-200",
  },
] as const;

const DWELLING_TYPES = [
  { value: "house", label: "House" },
  { value: "apartment", label: "Apartment" },
  { value: "condo", label: "Condo" },
  { value: "office_space", label: "Office Space" },
  { value: "townhouse", label: "Townhouse" },
  { value: "mansion", label: "Mansion" },
];

// Small +/- counter used for bedrooms + bathrooms. Better mobile tap
// targets than a number input + visible current value.
function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 10,
  step = 1,
  Icon,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  Icon: typeof RiHome4Line;
}) {
  const dec = () => onChange(Math.max(min, Math.round((value - step) * 10) / 10));
  const inc = () => onChange(Math.min(max, Math.round((value + step) * 10) / 10));
  const display = step < 1 ? value.toFixed(1).replace(/\.0$/, "") : String(value);
  return (
    <div className="flex items-center justify-between rounded-xl border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-full"
          onClick={dec}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
        >
          <RiSubtractLine className="h-4 w-4" />
        </Button>
        <span className="w-8 text-center text-base font-semibold tabular-nums">{display}</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-full"
          onClick={inc}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
        >
          <RiAddLine className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function ModifyBookingDialog({
  booking,
  open,
  onOpenChange,
  onSuccess,
}: ModifyBookingDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [serviceType, setServiceType] = useState(booking?.service_type || "standard");
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>(booking?.add_ons || []);
  const [bedrooms, setBedrooms] = useState<number>(booking?.bedrooms ?? 1);
  const [bathrooms, setBathrooms] = useState<number>(booking?.bathrooms ?? 1);
  const [dwellingType, setDwellingType] = useState(booking?.dwelling_type || "");

  useEffect(() => {
    if (booking) {
      setServiceType(booking.service_type);
      setSelectedAddOns(booking.add_ons || []);
      setBedrooms(booking.bedrooms ?? 1);
      setBathrooms(booking.bathrooms ?? 1);
      setDwellingType(booking.dwelling_type || "");
    }
  }, [booking]);

  // Effective add-ons sent to the server. moveInOut filters out
  // fridge + oven (those are bundled into the tier price already).
  const effectiveAddOns = useMemo(
    () =>
      serviceType === "moveInOut"
        ? selectedAddOns.filter((a) => a === "windows")
        : selectedAddOns,
    [serviceType, selectedAddOns],
  );

  const availableAddOns = useMemo(
    () =>
      serviceType === "moveInOut"
        ? Object.entries(ADD_ONS).filter(([id]) => id === "windows")
        : Object.entries(ADD_ONS).filter(([id]) => !OPS_ONLY_ADD_ON_IDS.has(id) || selectedAddOns.includes(id)),
    [serviceType, selectedAddOns],
  );

  if (!booking) return null;

  const toggleAddOn = (addonId: string) =>
    setSelectedAddOns((prev) =>
      prev.includes(addonId) ? prev.filter((id) => id !== addonId) : [...prev, addonId],
    );

  // Pricing comparison
  const originalPricing = calculatePrice(
    booking.home_size_id,
    booking.service_type,
    booking.add_ons || [],
    booking.membership_plan,
    booking.uses_credit,
    false,
  );

  const newPricing = calculatePrice(
    booking.home_size_id,
    serviceType,
    effectiveAddOns,
    booking.membership_plan,
    booking.uses_credit,
    false,
  );

  const priceDifference = newPricing.total - originalPricing.total;
  const hasChanges =
    serviceType !== booking.service_type ||
    JSON.stringify(selectedAddOns.slice().sort()) !==
      JSON.stringify((booking.add_ons || []).slice().sort()) ||
    bedrooms !== (booking.bedrooms ?? 1) ||
    bathrooms !== (booking.bathrooms ?? 1) ||
    dwellingType !== (booking.dwelling_type || "");

  const handleSubmit = async () => {
    if (!hasChanges) {
      toast.info("No changes to save");
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("modify-booking", {
        body: {
          bookingId: booking.id,
          serviceType,
          addOns: effectiveAddOns,
          bedrooms,
          bathrooms,
          dwellingType: dwellingType || null,
        },
      });

      if (error) throw error;

      if (data?.requiresPayment && data?.checkoutUrl) {
        toast.info("Redirecting to checkout for the additional charge…");
        window.location.href = data.checkoutUrl;
      } else {
        toast.success("Booking updated. Confirmation on its way.");
        onSuccess();
        onOpenChange(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to modify booking";
      console.error("Error modifying booking:", err);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const footer = (
    <div className="flex w-full gap-3 sm:justify-end">
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={isLoading}
        className="flex-1 sm:flex-none"
      >
        Cancel
      </Button>
      <Button
        onClick={handleSubmit}
        disabled={isLoading || !hasChanges}
        className="flex-1 bg-gradient-primary sm:flex-none"
      >
        {isLoading ? (
          <>
            <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
            Updating…
          </>
        ) : priceDifference > 0 ? (
          `Confirm & Pay +$${priceDifference.toFixed(2)}`
        ) : (
          "Confirm Changes"
        )}
      </Button>
    </div>
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Modify Booking"
      description="Adjust service, add-ons, and property details before your scheduled date."
      desktopMaxWidthClass="max-w-3xl"
      footer={footer}
      bodyClassName="bg-muted/20"
    >
      <div className="space-y-6">
        {/* Pricing strip — fixed at the top so the customer always sees the
            running delta as they toggle options. */}
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-background to-background shadow-sm">
          <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="flex items-center gap-4">
              <div className="text-left">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Current
                </p>
                <p className="text-base font-semibold text-muted-foreground line-through">
                  ${originalPricing.total.toFixed(2)}
                </p>
              </div>
              <div className="text-left">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                  New Total
                </p>
                <p className="text-xl font-bold tabular-nums">
                  ${newPricing.total.toFixed(2)}
                </p>
              </div>
            </div>
            {priceDifference !== 0 ? (
              <Badge
                className={cn(
                  "self-start text-xs font-semibold sm:self-center",
                  priceDifference > 0
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-emerald-300 bg-emerald-50 text-emerald-700",
                )}
                variant="outline"
              >
                {priceDifference > 0 ? "+" : "−"}${Math.abs(priceDifference).toFixed(2)}
                <span className="ml-1 font-normal opacity-70">
                  {priceDifference > 0 ? "additional charge" : "credit"}
                </span>
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="self-start border-muted text-xs font-medium text-muted-foreground sm:self-center"
              >
                No change
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* SECTION 1: Service tier — visual gradient cards */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Service Tier
            </h3>
            <p className="text-[11px] text-muted-foreground">Tap to switch</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {SERVICES.map((service) => {
              const Icon = service.icon;
              const isSelected = serviceType === service.id;
              return (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => setServiceType(service.id)}
                  className={cn(
                    "group relative overflow-hidden rounded-xl border bg-gradient-to-br p-3 text-left transition-all",
                    "focus:outline-none focus:ring-2 focus:ring-primary/40 active:scale-[0.98]",
                    isSelected
                      ? "border-primary ring-2 ring-primary/30 shadow-md"
                      : cn("hover:shadow-md", service.accent),
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-lg",
                        isSelected ? "bg-primary text-primary-foreground" : "bg-background/70 text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    {isSelected && (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <RiCheckLine className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-semibold">{service.name}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {service.blurb}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        {/* SECTION 2: Add-ons — pill-shaped toggle row */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Add-Ons
            </h3>
            {serviceType === "moveInOut" && (
              <p className="text-[11px] text-emerald-700">
                Fridge &amp; oven included
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {availableAddOns.map(([id, addon]) => {
              const isSelected = selectedAddOns.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleAddOn(id)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-all",
                    "focus:outline-none focus:ring-2 focus:ring-primary/40 active:scale-95",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-background hover:border-primary/40 hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full border-[1.5px]",
                      isSelected ? "border-primary-foreground bg-primary-foreground/20" : "border-muted-foreground/40",
                    )}
                  >
                    {isSelected && <RiCheckLine className="h-3 w-3" />}
                  </span>
                  {(addon as { label: string }).label}
                  <span
                    className={cn(
                      "text-xs font-semibold tabular-nums",
                      isSelected ? "opacity-80" : "text-muted-foreground",
                    )}
                  >
                    +${(addon as { price: number }).price}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* SECTION 3: Property details — steppers + dwelling select */}
        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Property
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Stepper
              label="Bedrooms"
              value={bedrooms}
              onChange={setBedrooms}
              min={0}
              max={10}
              step={1}
              Icon={RiHotelBedLine}
            />
            <Stepper
              label="Bathrooms"
              value={bathrooms}
              onChange={setBathrooms}
              min={0}
              max={10}
              step={0.5}
              Icon={RiHome4Line}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dwelling" className="text-xs font-medium text-muted-foreground">
              Dwelling type
            </Label>
            <Select value={dwellingType} onValueChange={setDwellingType}>
              <SelectTrigger id="dwelling" className="h-11">
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
        </section>

        {/* SECTION 4: Inline notice when extra payment is required */}
        {priceDifference > 0 && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <RiErrorWarningLine className="h-4 w-4" />
            <AlertDescription className="text-xs">
              An additional <strong>${priceDifference.toFixed(2)}</strong> is required.
              You'll be sent to a secure checkout to authorize the charge before the
              update takes effect.
            </AlertDescription>
          </Alert>
        )}
        {priceDifference < 0 && (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
            <RiInformationLine className="h-4 w-4" />
            <AlertDescription className="text-xs">
              You'll receive a <strong>${Math.abs(priceDifference).toFixed(2)}</strong>{" "}
              account credit for use on your next cleaning.
            </AlertDescription>
          </Alert>
        )}

      </div>
    </ResponsiveModal>
  );
}
