import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Sparkles, Zap, Package, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { calculatePrice, SERVICE_TIER_PRICING, ADD_ONS, HOME_SIZE_RANGES } from "@/lib/pricing-system";
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

const SERVICES = [
  { id: 'standard', icon: Sparkles, name: 'Standard', description: 'Base hourly cleaning service' },
  { id: 'deep', icon: Zap, name: 'Deep Clean', description: '+$50 on Standard' },
  { id: 'moveInOut', icon: Package, name: 'Move-In/Out', description: '+$120 (includes fridge & oven)' },
];

const DWELLING_TYPES = [
  { value: 'house', label: 'House' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'condo', label: 'Condo' },
  { value: 'office_space', label: 'Office Space' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'mansion', label: 'Mansion' },
];

export function ModifyBookingDialog({ booking, open, onOpenChange, onSuccess }: ModifyBookingDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [serviceType, setServiceType] = useState(booking?.service_type || 'standard');
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>(booking?.add_ons || []);
  const [bedrooms, setBedrooms] = useState(booking?.bedrooms?.toString() || '');
  const [bathrooms, setBathrooms] = useState(booking?.bathrooms?.toString() || '');
  const [dwellingType, setDwellingType] = useState(booking?.dwelling_type || '');

  useEffect(() => {
    if (booking) {
      setServiceType(booking.service_type);
      setSelectedAddOns(booking.add_ons || []);
      setBedrooms(booking.bedrooms?.toString() || '');
      setBathrooms(booking.bathrooms?.toString() || '');
      setDwellingType(booking.dwelling_type || '');
    }
  }, [booking]);

  if (!booking) return null;

  const handleAddOnToggle = (addonId: string) => {
    setSelectedAddOns(prev => 
      prev.includes(addonId) 
        ? prev.filter(id => id !== addonId)
        : [...prev, addonId]
    );
  };

  // Calculate pricing
  const originalPricing = calculatePrice(
    booking.home_size_id,
    booking.service_type,
    booking.add_ons || [],
    booking.membership_plan,
    booking.uses_credit,
    false // Not new customer
  );

  const newPricing = calculatePrice(
    booking.home_size_id,
    serviceType,
    serviceType === 'moveInOut' ? selectedAddOns.filter(a => a === 'windows') : selectedAddOns,
    booking.membership_plan,
    booking.uses_credit,
    false
  );

  const priceDifference = newPricing.total - originalPricing.total;
  const hasChanges = serviceType !== booking.service_type || 
                     JSON.stringify(selectedAddOns.sort()) !== JSON.stringify((booking.add_ons || []).sort()) ||
                     bedrooms !== booking.bedrooms?.toString() ||
                     bathrooms !== booking.bathrooms?.toString() ||
                     dwellingType !== booking.dwelling_type;

  const handleSubmit = async () => {
    if (!hasChanges) {
      toast.info("No changes to save");
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('modify-booking', {
        body: {
          bookingId: booking.id,
          serviceType,
          addOns: serviceType === 'moveInOut' ? selectedAddOns.filter(a => a === 'windows') : selectedAddOns,
          bedrooms: bedrooms ? parseInt(bedrooms) : null,
          bathrooms: bathrooms ? parseFloat(bathrooms) : null,
          dwellingType: dwellingType || null,
        },
      });

      if (error) throw error;

      if (data.requiresPayment) {
        toast.info("Additional payment required. Redirecting to checkout...");
        // Handle additional payment via Stripe Checkout
        window.location.href = data.checkoutUrl;
      } else {
        toast.success("Booking updated successfully!");
        onSuccess();
        onOpenChange(false);
      }
    } catch (error: any) {
      console.error('Error modifying booking:', error);
      toast.error(error.message || "Failed to modify booking");
    } finally {
      setIsLoading(false);
    }
  };

  // Filter out fridge & oven for moveInOut
  const availableAddOns = serviceType === 'moveInOut' 
    ? Object.entries(ADD_ONS).filter(([id]) => id === 'windows')
    : Object.entries(ADD_ONS);

  const homeSize = HOME_SIZE_RANGES.find(h => h.id === booking.home_size_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modify Booking</DialogTitle>
          <DialogDescription>
            Update your cleaning service details before your scheduled date
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Service Type Selection */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Service Type</Label>
            <div className="grid gap-3">
              {SERVICES.map((service) => {
                const Icon = service.icon;
                const isSelected = serviceType === service.id;
                return (
                  <Card
                    key={service.id}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md",
                      isSelected && "border-primary ring-2 ring-primary/20"
                    )}
                    onClick={() => setServiceType(service.id)}
                  >
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center",
                        isSelected ? "bg-primary text-white" : "bg-muted"
                      )}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold">{service.name}</div>
                        <div className="text-sm text-muted-foreground">{service.description}</div>
                      </div>
                      {isSelected && (
                        <Badge variant="default">Selected</Badge>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Add-ons */}
          {availableAddOns.length > 0 && (
            <div className="space-y-3">
              <Label className="text-base font-semibold">Add Extra Services</Label>
              {serviceType === 'moveInOut' && (
                <p className="text-sm text-muted-foreground">
                  Fridge & Oven cleaning included with Move-In/Out service
                </p>
              )}
              <div className="space-y-2">
                {availableAddOns.map(([id, addon]) => (
                  <div key={id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={`addon-${id}`}
                        checked={selectedAddOns.includes(id)}
                        onCheckedChange={() => handleAddOnToggle(id)}
                      />
                      <label
                        htmlFor={`addon-${id}`}
                        className="text-sm font-medium cursor-pointer"
                      >
                        {addon.label}
                      </label>
                    </div>
                    <span className="text-sm font-semibold">${addon.price}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Property Details */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Property Details</Label>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="bedrooms">Bedrooms</Label>
                <Input
                  id="bedrooms"
                  type="number"
                  min="0"
                  max="10"
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bathrooms">Bathrooms</Label>
                <Input
                  id="bathrooms"
                  type="number"
                  min="0"
                  max="10"
                  step="0.5"
                  value={bathrooms}
                  onChange={(e) => setBathrooms(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dwelling">Dwelling Type</Label>
                <Select value={dwellingType} onValueChange={setDwellingType}>
                  <SelectTrigger id="dwelling">
                    <SelectValue placeholder="Select" />
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
            </div>
          </div>

          <Separator />

          {/* Pricing Summary */}
          <div className="space-y-3 bg-muted/50 p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Current Total</span>
              <span className="font-medium">${(originalPricing.total).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">New Total</span>
              <span className="font-semibold text-lg">${(newPricing.total).toFixed(2)}</span>
            </div>
            {priceDifference !== 0 && (
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="text-sm font-medium">
                  {priceDifference > 0 ? 'Additional Charge' : 'Refund'}
                </span>
                <span className={cn(
                  "font-semibold",
                  priceDifference > 0 ? "text-destructive" : "text-success"
                )}>
                  {priceDifference > 0 ? '+' : ''}${Math.abs(priceDifference).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          {priceDifference > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Additional payment of ${priceDifference.toFixed(2)} will be required to complete this modification.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={isLoading || !hasChanges}
            className="bg-gradient-primary"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Updating...
              </>
            ) : (
              `Confirm Changes${priceDifference > 0 ? ` (+$${priceDifference.toFixed(2)})` : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
