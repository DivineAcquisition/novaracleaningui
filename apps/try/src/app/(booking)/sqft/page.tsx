"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBooking } from "@/app/providers";
import { Home, ArrowRight, MessageSquare } from "lucide-react";
import Link from "next/link";

const homeSizes = [
  {
    id: "xs",
    label: "Studio/1BR",
    sqft: "Up to 800 sq ft",
    bedrooms: "0-1 Bedrooms",
    price: 14900,
    membershipPrice: 18900,
  },
  {
    id: "sm",
    label: "Small Home",
    sqft: "800-1,200 sq ft",
    bedrooms: "1-2 Bedrooms",
    price: 17900,
    membershipPrice: 18900,
  },
  {
    id: "md",
    label: "Medium Home",
    sqft: "1,200-1,800 sq ft",
    bedrooms: "2-3 Bedrooms",
    price: 21900,
    membershipPrice: 22900,
    popular: true,
  },
  {
    id: "lg",
    label: "Large Home",
    sqft: "1,800-2,500 sq ft",
    bedrooms: "3-4 Bedrooms",
    price: 26900,
    membershipPrice: 26900,
  },
  {
    id: "xl",
    label: "X-Large Home",
    sqft: "2,500-3,500 sq ft",
    bedrooms: "4-5 Bedrooms",
    price: 32900,
    membershipPrice: 32900,
  },
  {
    id: "xxl",
    label: "XX-Large Home",
    sqft: "3,500-5,000 sq ft",
    bedrooms: "5+ Bedrooms",
    price: 39900,
    membershipPrice: 39900,
  },
];

export default function SqftPage() {
  const router = useRouter();
  const { updateBookingData } = useBooking();

  const handleSelect = (sizeId: string) => {
    updateBookingData({ sqftTier: sizeId });
    router.push("/offer");
  };

  const formatPrice = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-3xl md:text-4xl font-bold">
          How Big Is Your Home?
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
          Select the size that best matches your home. This helps us provide an accurate quote.
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {homeSizes.map((size) => (
          <Card
            key={size.id}
            className={`cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] ${
              size.popular ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => handleSelect(size.id)}
          >
            <CardContent className="p-6 relative">
              {size.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                  Most Popular
                </Badge>
              )}
              
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Home className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{size.label}</h3>
                  <p className="text-sm text-muted-foreground">{size.sqft}</p>
                  <p className="text-sm text-muted-foreground">{size.bedrooms}</p>
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-sm text-muted-foreground">Starting at</p>
                    <p className="text-2xl font-bold text-primary">
                      {formatPrice(size.price)}
                    </p>
                  </div>
                </div>
              </div>
              
              <Button className="w-full mt-4" variant="outline">
                Select
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Custom Quote CTA */}
      <Card className="bg-muted/50 border-dashed">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                <MessageSquare className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Have a larger home?</h3>
                <p className="text-sm text-muted-foreground">
                  For homes over 5,000 sq ft, we'll create a custom quote just for you.
                </p>
              </div>
            </div>
            <Link href="/custom-quote">
              <Button variant="outline">
                Get Custom Quote
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
