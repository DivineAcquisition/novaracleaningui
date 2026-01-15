"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MapPin,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

const homeSizes = [
  { id: "xs", label: "Studio/1BR (up to 800 sq ft)" },
  { id: "sm", label: "Small (800-1,200 sq ft)" },
  { id: "md", label: "Medium (1,200-1,800 sq ft)" },
  { id: "lg", label: "Large (1,800-2,500 sq ft)" },
  { id: "xl", label: "X-Large (2,500-3,500 sq ft)" },
  { id: "xxl", label: "XX-Large (3,500+ sq ft)" },
];

export default function NewAddressPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    street: "",
    unit: "",
    city: "",
    state: "",
    zip: "",
    sqft_tier: "",
    bedrooms: "",
    bathrooms: "",
    is_primary: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.street || !formData.city || !formData.state || !formData.zip) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);
    try {
      // Get customer ID
      const { data: customer } = await supabase
        .from("customers")
        .select("id")
        .eq("email", user?.email)
        .single();

      if (!customer) {
        // Create customer if doesn't exist
        const { data: newCustomer, error: customerError } = await supabase
          .from("customers")
          .insert({
            email: user?.email,
            first_name: user?.user_metadata?.first_name || "",
            last_name: user?.user_metadata?.last_name || "",
          })
          .select()
          .single();

        if (customerError) throw customerError;
        
        const { error } = await supabase.from("addresses").insert({
          customer_id: newCustomer.id,
          street: formData.street,
          unit: formData.unit || null,
          city: formData.city,
          state: formData.state,
          zip: formData.zip,
          sqft_tier: formData.sqft_tier || null,
          bedrooms: formData.bedrooms ? parseInt(formData.bedrooms) : null,
          bathrooms: formData.bathrooms ? parseInt(formData.bathrooms) : null,
          is_primary: formData.is_primary,
        });

        if (error) throw error;
      } else {
        const { error } = await supabase.from("addresses").insert({
          customer_id: customer.id,
          street: formData.street,
          unit: formData.unit || null,
          city: formData.city,
          state: formData.state,
          zip: formData.zip,
          sqft_tier: formData.sqft_tier || null,
          bedrooms: formData.bedrooms ? parseInt(formData.bedrooms) : null,
          bathrooms: formData.bathrooms ? parseInt(formData.bathrooms) : null,
          is_primary: formData.is_primary,
        });

        if (error) throw error;
      }

      toast.success("Address added successfully");
      router.push("/dashboard/addresses");
    } catch (error) {
      console.error("Error adding address:", error);
      toast.error("Failed to add address");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/addresses">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Add Address</h1>
          <p className="text-muted-foreground">
            Add a new service address
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Address Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="street">Street Address *</Label>
              <Input
                id="street"
                placeholder="123 Main Street"
                value={formData.street}
                onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit">Apt/Unit (optional)</Label>
              <Input
                id="unit"
                placeholder="Apt 4B"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City *</Label>
                <Input
                  id="city"
                  placeholder="Austin"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State *</Label>
                <Input
                  id="state"
                  placeholder="TX"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zip">ZIP *</Label>
                <Input
                  id="zip"
                  placeholder="78701"
                  value={formData.zip}
                  onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sqft">Home Size</Label>
              <Select
                value={formData.sqft_tier}
                onValueChange={(value) => setFormData({ ...formData, sqft_tier: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select home size" />
                </SelectTrigger>
                <SelectContent>
                  {homeSizes.map((size) => (
                    <SelectItem key={size.id} value={size.id}>
                      {size.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bedrooms">Bedrooms</Label>
                <Select
                  value={formData.bedrooms}
                  onValueChange={(value) => setFormData({ ...formData, bedrooms: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6].map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bathrooms">Bathrooms</Label>
                <Select
                  value={formData.bathrooms}
                  onValueChange={(value) => setFormData({ ...formData, bathrooms: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 1.5, 2, 2.5, 3, 3.5, 4].map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="primary"
                checked={formData.is_primary}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_primary: checked as boolean })
                }
              />
              <label htmlFor="primary" className="text-sm">
                Set as primary address
              </label>
            </div>

            <div className="flex gap-3 pt-4">
              <Link href="/dashboard/addresses" className="flex-1">
                <Button variant="outline" className="w-full">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" className="flex-1" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Save Address"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
