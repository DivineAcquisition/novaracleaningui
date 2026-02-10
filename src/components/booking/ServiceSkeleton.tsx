"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ServiceSkeleton() {
  return (
    <div className="space-y-6">
      {/* Service Type Cards */}
      <Card variant="outlined">
        <CardHeader className="text-center space-y-4 pb-4">
          <Skeleton className="h-16 w-16 rounded-full mx-auto" />
          <Skeleton className="h-7 w-48 mx-auto" />
          <Skeleton className="h-4 w-64 mx-auto" />
        </CardHeader>
        
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i} className="border-2 border-border/50 min-h-[220px]">
                <CardContent className="p-6 space-y-3">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <div className="pt-2 space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Membership Card */}
      <Card className="border-2 border-border/50">
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-10 w-24" />
          </div>
        </CardContent>
      </Card>

      {/* Add-ons */}
      <Card variant="outlined">
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48 mt-2" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between p-4 border-2 border-border/60 rounded-lg">
              <div className="flex items-center gap-3 flex-1">
                <Skeleton className="h-5 w-5" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-48" />
                </div>
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
