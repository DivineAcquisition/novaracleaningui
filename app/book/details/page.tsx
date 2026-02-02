"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Home,
  Bed,
  Bath,
  ArrowRight,
  Dog,
  Key,
  Loader2,
  ClipboardList,
} from "lucide-react";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const DWELLING_TYPES = [
  { id: "house", label: "House", icon: Home },
  { id: "apartment", label: "Apartment", icon: Home },
  { id: "condo", label: "Condo", icon: Home },
  { id: "townhouse", label: "Townhouse", icon: Home },
];

export default function BookingDetails() {
  const router = useRouter();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();

  const [isProcessing, setIsProcessing] = useState(false);
  const [bedrooms, setBedrooms] = useState(bookingData.bedrooms?.toString() || "");
  const [bathrooms, setBathrooms] = useState(bookingData.bathrooms?.toString() || "");
  const [dwellingType, setDwellingType] = useState(bookingData.dwellingType || "");
  const [hasPets, setHasPets] = useState(false);
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [accessInstructions, setAccessInstructions] = useState("");

  const handleContinue = async () => {
    if (!bedrooms || !bathrooms || !dwellingType) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsProcessing(true);

    try {
      // Update booking in database
      const { error } = await supabase
        .from("bookings")
        .update({
          bedrooms: parseInt(bedrooms),
          bathrooms: parseFloat(bathrooms),
          dwelling_type: dwellingType,
          special_instructions: specialInstructions,
          access_instructions: accessInstructions,
          has_pets: hasPets,
        })
        .eq("id", bookingData.bookingId);

      if (error) throw error;

      updateBookingData({
        bedrooms: parseInt(bedrooms),
        bathrooms: parseFloat(bathrooms),
        dwellingType,
      });

      setCurrentStep(6);
      router.push("/book/confirmation");
    } catch (error: any) {
      console.error("Details error:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBack = () => {
    setCurrentStep(4);
    router.push("/book/checkout");
  };

  return (
    <div className="min-h-screen bg-gradient-hero pb-24">
      <BookingHeader currentStep={5} totalSteps={6} stepLabel="Details" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="container max-w-2xl mx-auto px-4 py-8"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="mx-auto w-16 h-16 bg-gradient-primary rounded-2xl flex items-center justify-center mb-4 shadow-lg"
          >
            <ClipboardList className="w-8 h-8 text-white" />
          </motion.div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Property Details</h1>
          <p className="text-muted-foreground">
            Help us prepare for your cleaning
          </p>
        </div>

        <div className="space-y-6">
          {/* Property Type */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Home className="w-5 h-5 text-primary" />
                  Property Type
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={dwellingType}
                  onValueChange={setDwellingType}
                  className="grid grid-cols-2 gap-3"
                >
                  {DWELLING_TYPES.map((type) => (
                    <Label
                      key={type.id}
                      htmlFor={type.id}
                      className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${
                        dwellingType === type.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <RadioGroupItem value={type.id} id={type.id} />
                      <span className="font-medium">{type.label}</span>
                    </Label>
                  ))}
                </RadioGroup>
              </CardContent>
            </Card>
          </motion.div>

          {/* Rooms */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Room Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="bedrooms" className="flex items-center gap-2 mb-2">
                      <Bed className="w-4 h-4 text-muted-foreground" />
                      Bedrooms
                    </Label>
                    <Input
                      id="bedrooms"
                      type="number"
                      min="0"
                      max="10"
                      value={bedrooms}
                      onChange={(e) => setBedrooms(e.target.value)}
                      placeholder="0"
                      className="h-12 text-lg"
                    />
                  </div>
                  <div>
                    <Label htmlFor="bathrooms" className="flex items-center gap-2 mb-2">
                      <Bath className="w-4 h-4 text-muted-foreground" />
                      Bathrooms
                    </Label>
                    <Input
                      id="bathrooms"
                      type="number"
                      min="0"
                      max="10"
                      step="0.5"
                      value={bathrooms}
                      onChange={(e) => setBathrooms(e.target.value)}
                      placeholder="0"
                      className="h-12 text-lg"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Additional Info */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Additional Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Pets */}
                <div className="flex items-center space-x-3 p-4 border rounded-xl">
                  <Checkbox
                    id="pets"
                    checked={hasPets}
                    onCheckedChange={(checked) => setHasPets(checked as boolean)}
                  />
                  <Label htmlFor="pets" className="flex items-center gap-2 cursor-pointer">
                    <Dog className="w-4 h-4 text-muted-foreground" />
                    I have pets
                  </Label>
                </div>

                {/* Access Instructions */}
                <div>
                  <Label htmlFor="access" className="flex items-center gap-2 mb-2">
                    <Key className="w-4 h-4 text-muted-foreground" />
                    Access Instructions
                  </Label>
                  <Textarea
                    id="access"
                    value={accessInstructions}
                    onChange={(e) => setAccessInstructions(e.target.value)}
                    placeholder="e.g., Code for lockbox is 1234, key under mat..."
                    rows={2}
                  />
                </div>

                {/* Special Instructions */}
                <div>
                  <Label htmlFor="special" className="mb-2 block">
                    Special Instructions (optional)
                  </Label>
                  <Textarea
                    id="special"
                    value={specialInstructions}
                    onChange={(e) => setSpecialInstructions(e.target.value)}
                    placeholder="Any areas to focus on or avoid?"
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Navigation */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex justify-between pt-4"
          >
            <Button variant="outline" onClick={handleBack}>
              ← Back
            </Button>
            <Button
              onClick={handleContinue}
              disabled={isProcessing || !bedrooms || !bathrooms || !dwellingType}
              className="bg-gradient-primary min-w-[200px]"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Complete Booking
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </motion.div>
        </div>
      </motion.div>

      <BookingFooter />
    </div>
  );
}
