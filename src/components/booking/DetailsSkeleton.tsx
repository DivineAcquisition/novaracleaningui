import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function DetailsSkeleton() {
  return (
    <Card variant="outlined" className="shadow-card">
      <CardContent className="p-8">
        <div className="space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>

          {/* Contact Information */}
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-12 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>

            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-12 w-full" />
            </div>

            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>

          {/* Service Address */}
          <div className="space-y-4">
            <Skeleton className="h-6 w-32" />
            
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-12 w-full" />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-12 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <Skeleton className="h-14 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
