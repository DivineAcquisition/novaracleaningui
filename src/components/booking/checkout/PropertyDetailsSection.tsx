import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Home } from "lucide-react";

const DWELLING_TYPES = [
  { value: "single_family", label: "Single Family Home" },
  { value: "townhouse", label: "Townhouse" },
  { value: "apartment", label: "Apartment" },
  { value: "condo", label: "Condo" },
  { value: "mansion", label: "Mansion/Estate" },
  { value: "mobile_home", label: "Mobile Home" },
  { value: "other", label: "Other" },
];

interface PropertyDetailsSectionProps {
  bedrooms: string;
  bathrooms: string;
  dwellingType: string;
  onChange: (field: string, value: string) => void;
}

export function PropertyDetailsSection({ 
  bedrooms, 
  bathrooms, 
  dwellingType, 
  onChange 
}: PropertyDetailsSectionProps) {
  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-primary mb-4">
          <Home className="w-5 h-5" />
          <h3 className="text-lg font-semibold">Property Details</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="bedrooms">Bedrooms *</Label>
            <Select value={bedrooms} onValueChange={(value) => onChange('bedrooms', value)}>
              <SelectTrigger id="bedrooms">
                <SelectValue placeholder="Select bedrooms" />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 11 }, (_, i) => i).map((num) => (
                  <SelectItem key={num} value={num.toString()}>
                    {num === 10 ? '10+' : num}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="bathrooms">Bathrooms *</Label>
            <Select value={bathrooms} onValueChange={(value) => onChange('bathrooms', value)}>
              <SelectTrigger id="bathrooms">
                <SelectValue placeholder="Select bathrooms" />
              </SelectTrigger>
              <SelectContent>
                {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((num) => (
                  <SelectItem key={num} value={num.toString()}>
                    {num === 10 ? '10+' : num}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="dwellingType">Dwelling Type *</Label>
          <Select value={dwellingType} onValueChange={(value) => onChange('dwellingType', value)}>
            <SelectTrigger id="dwellingType">
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
      </CardContent>
    </Card>
  );
}