import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin } from "lucide-react";
import { US_STATES } from "@/lib/us-states";

interface ServiceAddressSectionProps {
  address: string;
  city: string;
  state: string;
  zipCode: string;
  onChange: (field: string, value: string) => void;
}

export function ServiceAddressSection({ 
  address, 
  city, 
  state, 
  zipCode, 
  onChange 
}: ServiceAddressSectionProps) {
  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-primary mb-4">
          <MapPin className="w-5 h-5" />
          <h3 className="text-lg font-semibold">Service Address</h3>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="address">Street Address *</Label>
          <Input
            id="address"
            value={address}
            onChange={(e) => onChange('address', e.target.value)}
            placeholder="123 Main Street"
            required
          />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="city">City *</Label>
            <Input
              id="city"
              value={city}
              onChange={(e) => onChange('city', e.target.value)}
              placeholder="San Francisco"
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="state">State *</Label>
            <Select value={state} onValueChange={(value) => onChange('state', value)}>
              <SelectTrigger id="state">
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                {US_STATES.map((usState) => (
                  <SelectItem key={usState.value} value={usState.value}>
                    {usState.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="zipCode">ZIP Code *</Label>
          <Input
            id="zipCode"
            value={zipCode}
            onChange={(e) => onChange('zipCode', e.target.value)}
            placeholder="94102"
            required
            disabled
          />
          <p className="text-xs text-muted-foreground">ZIP code from booking start</p>
        </div>
      </CardContent>
    </Card>
  );
}