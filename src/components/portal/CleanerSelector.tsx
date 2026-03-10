"use client";

import {
  RiCheckLine,
  RiSparklingLine,
  RiStarLine,
  RiTrophyLine,
  RiUserLine
} from "@remixicon/react";
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';

import { cn } from '@/lib/utils';
import { useAvailableCleaners, AvailableCleaner } from '@/hooks/use-available-cleaners';

interface CleanerSelectorProps {
  zipCode?: string;
  customerEmail?: string;
  selectedCleanerId: string | null;
  onSelectCleaner: (cleanerId: string | null, cleanerName?: string) => void;
}

export function CleanerSelector({
  zipCode,
  customerEmail,
  selectedCleanerId,
  onSelectCleaner,
}: CleanerSelectorProps) {
  const { cleaners, previousCleaners, loading } = useAvailableCleaners({
    zipCode,
    customerEmail,
    preferPreviousCleaner: true,
  });

  const [showAllCleaners, setShowAllCleaners] = useState(false);

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  };

  const getRatingDisplay = (rating: number | null, count: number | null) => {
    if (!count || count === 0) return null;
    return (
      <div className="flex items-center gap-1 text-sm">
        <RiStarLine className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
        <span className="font-medium">{rating?.toFixed(1)}</span>
        <span className="text-muted-foreground">({count})</span>
      </div>
    );
  };

  const CleanerCard = ({
    cleaner,
    isPreviousCleaner = false,
  }: {
    cleaner: AvailableCleaner;
    isPreviousCleaner?: boolean;
  }) => {
    const isSelected = selectedCleanerId === cleaner.id;

    return (
      <Card
        className={cn(
          'relative cursor-pointer transition-all hover:shadow-md',
          isSelected
            ? 'border-2 border-primary bg-primary/5 shadow-lg'
            : 'border hover:border-primary/50',
          isPreviousCleaner && !isSelected && 'border-success/30 bg-success/5'
        )}
        onClick={() => onSelectCleaner(
          isSelected ? null : cleaner.id,
          isSelected ? undefined : `${cleaner.first_name} ${cleaner.last_name.charAt(0)}.`
        )}
      >
        {isSelected && (
          <div className="absolute -top-2 -right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center shadow-md">
            <RiCheckLine className="w-4 h-4 text-white" />
          </div>
        )}

        {isPreviousCleaner && !isSelected && (
          <div className="absolute -top-2 left-3">
            <Badge className="bg-success text-white text-xs shadow-sm">
              <RiSparklingLine className="w-3 h-3 mr-1" />
              Your Previous Cleaner
            </Badge>
          </div>
        )}

        <CardContent className={cn('p-4', isPreviousCleaner && 'pt-6')}>
          <div className="flex items-start gap-3">
            <Avatar className="w-12 h-12 border-2 border-background shadow-sm">
              <AvatarImage src={cleaner.avatar_url || ''} alt={cleaner.first_name} />
              <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                {getInitials(cleaner.first_name, cleaner.last_name)}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-semibold text-base">
                    {cleaner.first_name} {cleaner.last_name.charAt(0)}.
                  </h4>
                  {getRatingDisplay(cleaner.average_rating, cleaner.total_ratings)}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mt-2">
                {cleaner.completed_bookings && cleaner.completed_bookings > 10 && (
                  <Badge variant="outline" className="text-xs bg-background">
                    <RiTrophyLine className="w-3 h-3 mr-1" />
                    {cleaner.completed_bookings}+ cleans
                  </Badge>
                )}
                {cleaner.skillset?.slice(0, 2).map((skill) => (
                  <Badge key={skill} variant="secondary" className="text-xs">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="w-12 h-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-20" />
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Separate cleaners - previous cleaners first, then others
  const otherCleaners = cleaners.filter(
    (c) => !previousCleaners.find((pc) => pc.id === c.id)
  );
  const displayedCleaners = showAllCleaners ? otherCleaners : otherCleaners.slice(0, 4);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <RiUserLine className="w-5 h-5 text-primary" />
          Request a Specific Cleaner
        </h3>
        <span className="text-sm text-muted-foreground">(Optional)</span>
      </div>

      {/* No Preference Option */}
      <Card
        className={cn(
          'cursor-pointer transition-all hover:shadow-md',
          selectedCleanerId === null
            ? 'border-2 border-primary bg-primary/5 shadow-lg'
            : 'border hover:border-primary/50'
        )}
        onClick={() => onSelectCleaner(null, undefined)}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <RiSparklingLine className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <h4 className="font-semibold">No Preference</h4>
              <p className="text-sm text-muted-foreground">
                We'll assign our best available cleaner for your area
              </p>
            </div>
            {selectedCleanerId === null && (
              <div className="ml-auto w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                <RiCheckLine className="w-4 h-4 text-white" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Previous Cleaners Section */}
      {previousCleaners.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Your Previous Cleaners
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {previousCleaners.map((cleaner) => (
              <CleanerCard key={cleaner.id} cleaner={cleaner} isPreviousCleaner />
            ))}
          </div>
        </div>
      )}

      {/* Other Available Cleaners Section */}
      {otherCleaners.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Available Cleaners in Your Area
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {displayedCleaners.map((cleaner) => (
              <CleanerCard key={cleaner.id} cleaner={cleaner} />
            ))}
          </div>

          {otherCleaners.length > 4 && (
            <div className="text-center">
              <Button
                variant="ghost"
                onClick={() => setShowAllCleaners(!showAllCleaners)}
              >
                {showAllCleaners
                  ? 'Show Less'
                  : `View All ${otherCleaners.length} Cleaners`}
              </Button>
            </div>
          )}
        </div>
      )}

      {cleaners.length === 0 && previousCleaners.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <RiUserLine className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              No cleaners available for your area at this time.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Don't worry - we'll assign a qualified cleaner to your booking.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
