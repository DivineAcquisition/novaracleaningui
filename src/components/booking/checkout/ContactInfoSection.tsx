import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User } from "lucide-react";

interface ContactInfoSectionProps {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  onChange: (field: string, value: string) => void;
}

export function ContactInfoSection({ 
  firstName, 
  lastName, 
  email, 
  phone, 
  onChange 
}: ContactInfoSectionProps) {
  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-primary mb-4">
          <User className="w-5 h-5" />
          <h3 className="text-lg font-semibold">Contact Information</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="firstName">First Name *</Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => onChange('firstName', e.target.value)}
              placeholder="John"
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="lastName">Last Name *</Label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => onChange('lastName', e.target.value)}
              placeholder="Doe"
              required
            />
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="email">Email *</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => onChange('email', e.target.value)}
            placeholder="john@example.com"
            required
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="phone">Phone Number *</Label>
          <Input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => onChange('phone', e.target.value)}
            placeholder="(555) 123-4567"
            required
          />
        </div>
      </CardContent>
    </Card>
  );
}