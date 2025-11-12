import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const DWELLING_TYPES = [
  { value: 'single_family', label: 'Single Family Home' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'condo', label: 'Condo' },
  { value: 'mansion', label: 'Mansion/Estate' },
  { value: 'mobile_home', label: 'Mobile Home' },
  { value: 'other', label: 'Other' },
];

export default function AdditionalDetails() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const bookingId = searchParams.get("booking_id");
  
  const [bedrooms, setBedrooms] = useState<string>("");
  const [bathrooms, setBathrooms] = useState<string>("");
  const [dwellingType, setDwellingType] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!bookingId) {
      toast.error("No booking ID found");
      navigate("/");
    }
  }, [bookingId, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bedrooms || !bathrooms || !dwellingType) {
      toast.error("Please fill in all property details");
      return;
    }

    if (!bookingId) {
      toast.error("Invalid booking");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from("bookings")
        .update({
          bedrooms: parseInt(bedrooms),
          bathrooms: parseFloat(bathrooms),
          dwelling_type: dwellingType,
        })
        .eq("id", bookingId);

      if (error) throw error;

      toast.success("Details saved successfully!");
      navigate("/book/success?booking_id=" + bookingId);
    } catch (error) {
      console.error("Error saving details:", error);
      toast.error("Failed to save details. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero px-3 md:px-4 py-8 md:py-12 flex items-center justify-center">
      <Card variant="outlined" className="max-w-lg w-full shadow-card animate-fade-in">
        <CardHeader className="text-center space-y-4 pb-6">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-primary" />
          </div>
          <CardTitle className="text-lg md:text-xl font-semibold">Property Details</CardTitle>
          <CardDescription className="text-sm">
            Help us prepare for your service
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="bedrooms">
                Number of Bedrooms <span className="text-destructive">*</span>
              </Label>
              <Select value={bedrooms} onValueChange={setBedrooms}>
                <SelectTrigger id="bedrooms" className="h-12">
                  <SelectValue placeholder="Select bedrooms" />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                    <SelectItem key={num} value={num.toString()}>
                      {num} {num === 1 ? 'bedroom' : 'bedrooms'}
                    </SelectItem>
                  ))}
                  <SelectItem value="10+">10+ bedrooms</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bathrooms">
                Number of Bathrooms <span className="text-destructive">*</span>
              </Label>
              <Select value={bathrooms} onValueChange={setBathrooms}>
                <SelectTrigger id="bathrooms" className="h-12">
                  <SelectValue placeholder="Select bathrooms" />
                </SelectTrigger>
                <SelectContent>
                  {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((num) => (
                    <SelectItem key={num} value={num.toString()}>
                      {num} {num === 1 ? 'bathroom' : 'bathrooms'}
                    </SelectItem>
                  ))}
                  <SelectItem value="5+">5+ bathrooms</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dwellingType">
                Dwelling Type <span className="text-destructive">*</span>
              </Label>
              <Select value={dwellingType} onValueChange={setDwellingType}>
                <SelectTrigger id="dwellingType" className="h-12">
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

            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting || !bedrooms || !bathrooms || !dwellingType}
              className="w-full h-12 md:h-14 text-base font-semibold"
            >
              {isSubmitting ? "Saving..." : "Complete Booking"}
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
