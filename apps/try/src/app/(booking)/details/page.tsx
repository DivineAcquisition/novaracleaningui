"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBooking } from "@/app/providers";
import { supabase } from "@/lib/supabase";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Home,
  MapPin,
  BedDouble,
  Bath,
  PawPrint,
  Key,
  ArrowRight,
  Loader2,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";

const dwellingTypes = [
  "Single Family Home",
  "Townhouse",
  "Condo/Apartment",
  "Duplex",
  "Mobile Home",
  "Other",
];

const flooringTypes = [
  "Mostly Hardwood",
  "Mostly Carpet",
  "Mostly Tile",
  "Mixed Flooring",
];

const petOptions = [
  "No Pets",
  "Dog(s)",
  "Cat(s)",
  "Dog(s) and Cat(s)",
  "Other Pets",
];

export default function DetailsPage() {
  const router = useRouter();
  const { bookingData, updateBookingData } = useBooking();
  const [isLoading, setIsLoading] = useState(false);

  const [formData, setFormData] = useState({
    address: bookingData.address || "",
    city: bookingData.city || "",
    state: bookingData.state || "",
    bedrooms: bookingData.bedrooms?.toString() || "",
    bathrooms: bookingData.bathrooms?.toString() || "",
    dwellingType: bookingData.dwellingType || "",
    pets: bookingData.pets || "",
    flooringType: bookingData.flooringType || "",
    accessNotes: bookingData.accessNotes || "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.address || !formData.city || !formData.state) {
      toast.error("Please fill in your address");
      return;
    }

    setIsLoading(true);
    try {
      // Update booking with property details
      const { error } = await supabase
        .from("bookings")
        .update({
          address: formData.address,
          city: formData.city,
          state: formData.state,
          bedrooms: formData.bedrooms ? parseInt(formData.bedrooms) : null,
          bathrooms: formData.bathrooms ? parseInt(formData.bathrooms) : null,
          dwelling_type: formData.dwellingType || null,
          pets: formData.pets || null,
          flooring_type: formData.flooringType || null,
          access_notes: formData.accessNotes || null,
        })
        .eq("email", bookingData.email)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        console.error("Update error:", error);
      }

      // Create/update address in addresses table
      const { error: addressError } = await supabase
        .from("addresses")
        .upsert({
          customer_id: null, // Will be linked when customer account is created
          street: formData.address,
          city: formData.city,
          state: formData.state,
          zip: bookingData.zipCode,
          sqft_tier: bookingData.sqftTier,
          bedrooms: formData.bedrooms ? parseInt(formData.bedrooms) : null,
          bathrooms: formData.bathrooms ? parseInt(formData.bathrooms) : null,
          dwelling_type: formData.dwellingType || null,
        });

      if (addressError) {
        console.error("Address error:", addressError);
      }

      updateBookingData({
        address: formData.address,
        city: formData.city,
        state: formData.state,
        bedrooms: formData.bedrooms ? parseInt(formData.bedrooms) : undefined,
        bathrooms: formData.bathrooms ? parseInt(formData.bathrooms) : undefined,
        dwellingType: formData.dwellingType,
        pets: formData.pets,
        flooringType: formData.flooringType,
        accessNotes: formData.accessNotes,
      });

      router.push("/confirmation");
    } catch (error) {
      console.error("Error saving details:", error);
      toast.error("Failed to save details. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold">
          Payment Successful!
        </h1>
        <p className="text-lg text-muted-foreground">
          Just a few more details to help us prepare for your cleaning
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Address Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Service Address
            </CardTitle>
            <CardDescription>
              Where should we come to clean?
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="address">Street Address</Label>
              <Input
                id="address"
                placeholder="123 Main Street"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  placeholder="Austin"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  placeholder="TX"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                  required
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Property Details Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5" />
              Property Details
            </CardTitle>
            <CardDescription>
              Help us understand your home better
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <BedDouble className="h-4 w-4" />
                  Bedrooms
                </Label>
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
                        {num} {num === 1 ? "Bedroom" : "Bedrooms"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Bath className="h-4 w-4" />
                  Bathrooms
                </Label>
                <Select
                  value={formData.bathrooms}
                  onValueChange={(value) => setFormData({ ...formData, bathrooms: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num} {num === 1 ? "Bathroom" : "Bathrooms"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Dwelling Type</Label>
              <Select
                value={formData.dwellingType}
                onValueChange={(value) => setFormData({ ...formData, dwellingType: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select dwelling type" />
                </SelectTrigger>
                <SelectContent>
                  {dwellingTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Primary Flooring</Label>
              <Select
                value={formData.flooringType}
                onValueChange={(value) => setFormData({ ...formData, flooringType: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select flooring type" />
                </SelectTrigger>
                <SelectContent>
                  {flooringTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <PawPrint className="h-4 w-4" />
                Pets
              </Label>
              <Select
                value={formData.pets}
                onValueChange={(value) => setFormData({ ...formData, pets: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select pet situation" />
                </SelectTrigger>
                <SelectContent>
                  {petOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Access Instructions Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Access Instructions
            </CardTitle>
            <CardDescription>
              How should our cleaner access your home?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="e.g., Ring doorbell. Gate code is 1234. Key is under the mat."
              value={formData.accessNotes}
              onChange={(e) => setFormData({ ...formData, accessNotes: e.target.value })}
              rows={3}
            />
          </CardContent>
        </Card>

        <Button
          type="submit"
          size="lg"
          className="w-full h-14 text-lg"
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              Complete Setup
              <ArrowRight className="ml-2 h-5 w-5" />
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
