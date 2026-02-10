"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ScheduleSkeleton() {
  return (
    <div className="space-y-4">
      {/* Banner Skeleton */}
      <Card className="border-2 border-border/50">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-8 w-8 rounded" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calendar Section */}
      <Card>
        <CardContent className="p-6 space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>

          {/* Calendar Grid */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Date Selection */}
            <div className="space-y-4">
              <Skeleton className="h-6 w-32" />
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="p-4 border-2 border-border/60 rounded-lg">
                    <div className="flex items-center gap-4">
                      <Skeleton className="w-12 h-16" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Time Selection */}
            <div className="space-y-4">
              <Skeleton className="h-6 w-32" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="p-4 border-2 border-border/60 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Skeleton className="w-10 h-10 rounded-lg" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
