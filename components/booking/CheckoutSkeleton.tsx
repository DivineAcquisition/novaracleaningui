import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function CheckoutSkeleton() {
  return (
    <div className="space-y-8">
      {/* Header Skeleton */}
      <div className="text-center space-y-4">
        <Skeleton className="h-16 w-16 rounded-full mx-auto" />
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-4 w-64 mx-auto" />
      </div>

      {/* Order Summary Skeleton */}
      <div className="space-y-6">
        <Skeleton className="h-6 w-32" />
        
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-2 border-border/50">
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-5 w-24" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>

          <Card className="border-2 border-border/50">
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-5 w-24" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Payment Options Skeleton */}
      <Card className="border-2 border-border/50">
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-6 w-40" />
          <div className="space-y-4">
            <div className="p-4 rounded-lg border-2 border-border/60">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-6 w-20" />
                </div>
                <Skeleton className="h-4 w-48" />
              </div>
            </div>

            <div className="p-4 rounded-lg border-2 border-border/60">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-6 w-20" />
                </div>
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Form Skeleton */}
      <Card className="border-2 border-border/50">
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>

      {/* Button Skeleton */}
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
