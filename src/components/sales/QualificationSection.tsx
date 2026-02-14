import { useState, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HOME_SIZES, SERVICE_TIERS, ADD_ONS } from "@/config/brand-config";
import { getFrequencyOptions } from "@/lib/sales-pricing";
import { useServiceCoverage } from "@/hooks/use-sales-data";
import { CheckCircle2, AlertTriangle, MapPin, Calendar, Clock, PawPrint } from "lucide-react";
import { cn } from "@/lib/utils";

const PROPERTY_TYPES = ["House", "Apartment", "Condo", "Townhome", "Commercial/Office"];
const URGENCY_OPTIONS = ["This week", "Next week", "Flexible", "Urgent/Same-day"];
const TIME_PREFERENCES = ["Morning (8am-12pm)", "Afternoon (12pm-4pm)", "Evening (4pm-7pm)"];

export interface QualificationData {
  serviceType: string;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  sqft: string;
  homeSizeId: string;
  zipCode: string;
  frequency: string;
  preferredDate: string;
  preferredTime: string;
  specialRequests: string;
  urgency: string;
  addOns: string[];
}

interface QualificationSectionProps {
  data: QualificationData;
  onChange: (data: QualificationData) => void;
}

export function QualificationSection({ data, onChange }: QualificationSectionProps) {
  const update = useCallback(
    (field: keyof QualificationData, value: any) => {
      onChange({ ...data, [field]: value });
    },
    [data, onChange]
  );

  const { data: coverage, isLoading: checkingZip } = useServiceCoverage(data.zipCode);

  // Calculate step progress
  const steps = [
    !!data.serviceType,
    !!data.propertyType,
    data.bedrooms > 0,
    data.bathrooms > 0,
    !!data.homeSizeId,
    data.zipCode.length >= 5,
    !!data.frequency,
    !!data.preferredDate,
  ];
  const completedSteps = steps.filter(Boolean).length;
  const progressPct = Math.round((completedSteps / steps.length) * 100);
  const frequencyOptions = getFrequencyOptions();

  const toggleAddOn = (id: string) => {
    const current = data.addOns || [];
    update("addOns", current.includes(id) ? current.filter((a) => a !== id) : [...current, id]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-amber-400" />
          Qualification
        </h2>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-400">{completedSteps}/{steps.length} complete</span>
          <Progress value={progressPct} className="w-32 h-2" />
        </div>
      </div>

      {/* Service Type */}
      <div className="space-y-3">
        <Label className="text-slate-300">Service Type</Label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {SERVICE_TIERS.map((tier) => (
            <button
              key={tier.id}
              onClick={() => update("serviceType", tier.id)}
              className={cn(
                "text-left p-4 rounded-xl border-2 transition-all",
                data.serviceType === tier.id
                  ? "border-amber-500 bg-amber-500/10"
                  : "border-slate-700 bg-slate-800/50 hover:border-slate-600"
              )}
            >
              <div className="font-semibold text-white text-sm">{tier.name}</div>
              <div className="text-xs text-slate-400 mt-1">{tier.description}</div>
              {tier.additionalCost > 0 && (
                <Badge className="mt-2 bg-slate-700 text-slate-300 text-xs">+${tier.additionalCost}</Badge>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Property Type & Rooms */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="space-y-2">
          <Label className="text-slate-300">Property Type</Label>
          <Select value={data.propertyType} onValueChange={(v) => update("propertyType", v)}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {PROPERTY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Bedrooms</Label>
          <Select value={String(data.bedrooms || "")} onValueChange={(v) => update("bedrooms", parseInt(v))}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
              <SelectValue placeholder="# BR" />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <SelectItem key={n} value={String(n)}>{n} BR</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Bathrooms</Label>
          <Select value={String(data.bathrooms || "")} onValueChange={(v) => update("bathrooms", parseFloat(v))}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
              <SelectValue placeholder="# BA" />
            </SelectTrigger>
            <SelectContent>
              {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((n) => (
                <SelectItem key={n} value={String(n)}>{n} BA</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Approx. Sqft</Label>
          <Input
            value={data.sqft}
            onChange={(e) => update("sqft", e.target.value)}
            placeholder="e.g. 2000"
            className="bg-slate-800 border-slate-700 text-white"
          />
        </div>
      </div>

      {/* Home Size Selector */}
      <div className="space-y-3">
        <Label className="text-slate-300">Home Size (for pricing)</Label>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {HOME_SIZES.map((size) => (
            <button
              key={size.id}
              onClick={() => update("homeSizeId", size.id)}
              className={cn(
                "p-3 rounded-lg border text-center transition-all text-sm",
                data.homeSizeId === size.id
                  ? "border-amber-500 bg-amber-500/10 text-white"
                  : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
              )}
            >
              <div className="font-bold">{size.label}</div>
              <div className="text-xs mt-1">{size.sqftRange}</div>
              <div className="text-xs text-amber-400 mt-1">${size.basePrice}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ZIP + Service Area Validation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-slate-300 flex items-center gap-2">
            <MapPin className="w-4 h-4" /> ZIP Code
          </Label>
          <Input
            value={data.zipCode}
            onChange={(e) => update("zipCode", e.target.value)}
            placeholder="e.g. 20814"
            maxLength={5}
            className="bg-slate-800 border-slate-700 text-white"
          />
          {data.zipCode.length >= 5 && !checkingZip && (
            coverage ? (
              <div className="flex items-center gap-2 text-emerald-400 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                Service area confirmed: {coverage.city}, {coverage.state} ({coverage.tier_label})
              </div>
            ) : (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertTriangle className="w-4 h-4" />
                Outside service area — inform lead politely & capture info for future expansion
              </div>
            )
          )}
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Urgency</Label>
          <Select value={data.urgency} onValueChange={(v) => update("urgency", v)}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
              <SelectValue placeholder="How soon?" />
            </SelectTrigger>
            <SelectContent>
              {URGENCY_OPTIONS.map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Frequency */}
      <div className="space-y-3">
        <Label className="text-slate-300">Frequency</Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {frequencyOptions.map(({ label, discount }) => (
            <button
              key={label}
              onClick={() => update("frequency", label)}
              className={cn(
                "p-3 rounded-lg border text-center transition-all",
                data.frequency === label
                  ? "border-amber-500 bg-amber-500/10 text-white"
                  : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
              )}
            >
              <div className="font-semibold text-sm">{label}</div>
              {discount > 0 && (
                <div className="text-xs text-emerald-400 mt-1">Save {discount}%</div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Date / Time */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-slate-300 flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Preferred Date
          </Label>
          <Input
            type="date"
            value={data.preferredDate}
            onChange={(e) => update("preferredDate", e.target.value)}
            className="bg-slate-800 border-slate-700 text-white"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Preferred Time
          </Label>
          <Select value={data.preferredTime} onValueChange={(v) => update("preferredTime", v)}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
              <SelectValue placeholder="Time preference" />
            </SelectTrigger>
            <SelectContent>
              {TIME_PREFERENCES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Add-ons */}
      <div className="space-y-3">
        <Label className="text-slate-300">Add-ons</Label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {ADD_ONS.map((addon) => (
            <button
              key={addon.id}
              onClick={() => toggleAddOn(addon.id)}
              className={cn(
                "p-3 rounded-lg border text-left transition-all text-sm",
                data.addOns?.includes(addon.id)
                  ? "border-amber-500 bg-amber-500/10"
                  : "border-slate-700 bg-slate-800/50 hover:border-slate-600"
              )}
            >
              <div className="flex justify-between items-start">
                <span className="text-white font-medium">{addon.name}</span>
                <span className="text-amber-400 text-xs">+${addon.price}</span>
              </div>
              {addon.description && (
                <div className="text-xs text-slate-400 mt-1">{addon.description}</div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Special Requests */}
      <div className="space-y-2">
        <Label className="text-slate-300 flex items-center gap-2">
          <PawPrint className="w-4 h-4" /> Special Requests
        </Label>
        <Textarea
          value={data.specialRequests}
          onChange={(e) => update("specialRequests", e.target.value)}
          placeholder="Pets, allergies, focus areas, access instructions, gate codes..."
          className="bg-slate-800 border-slate-700 text-white min-h-[60px]"
        />
      </div>
    </div>
  );
}
