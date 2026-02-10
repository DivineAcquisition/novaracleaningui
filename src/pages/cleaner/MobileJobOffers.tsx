"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, MapPin, DollarSign, Briefcase } from "lucide-react";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { MobileBottomNav } from "@/components/mobile/MobileBottomNav";
import { PullToRefresh } from "@/components/mobile/PullToRefresh";
import { Skeleton } from "@/components/ui/skeleton";
import { useNativeHaptics } from "@/hooks/use-native-haptics";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface JobOffer {
  id: string;
  job_id: string;
  role: string;
  status: string;
  assigned_at: string;
  estimated_pay_cents: number;
  distance_miles: number;
  jobs: {
    service_type: string;
    start_datetime: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  };
}

export default function MobileJobOffers() {
  const router = useRouter();
  const [offers, setOffers] = useState<JobOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const { impact, notification } = useNativeHaptics();

  const fetchOffers = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/cleaner/auth");
        return;
      }

      const { data: cleanerData } = await supabase
        .from("cleaners")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!cleanerData) return;

      const { data: offersData, error } = await supabase
        .from("job_assignments")
        .select(`
          *,
          jobs (
            service_type,
            start_datetime,
            address,
            city,
            state,
            zip
          )
        `)
        .eq("cleaner_id", cleanerData.id)
        .eq("status", "pending")
        .order("assigned_at", { ascending: false });

      if (error) throw error;
      setOffers(offersData || []);
    } catch (error) {
      console.error("Error fetching offers:", error);
      toast({
        title: "Error",
        description: "Failed to load job offers",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOffers();

    const channel = supabase
      .channel("job-assignments-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "job_assignments",
        },
        () => {
          fetchOffers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleResponse = async (assignmentId: string, accepted: boolean) => {
    setRespondingTo(assignmentId);
    impact('medium');

    try {
      const { error } = await supabase.functions.invoke("respond-to-offer", {
        body: { assignmentId, accepted },
      });

      if (error) throw error;

      notification(accepted ? 'success' : 'warning');
      toast({
        title: accepted ? "Offer accepted!" : "Offer declined",
        description: accepted 
          ? "You'll receive more details shortly" 
          : "The offer has been declined",
      });

      await fetchOffers();
    } catch (error) {
      console.error("Error responding to offer:", error);
      toast({
        title: "Error",
        description: "Failed to respond to offer. Please try again.",
        variant: "destructive",
      });
    } finally {
      setRespondingTo(null);
    }
  };

  const handleRefresh = async () => {
    await fetchOffers();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <MobileHeader title="Job Offers" />
        <div className="p-4 space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
        <MobileBottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <MobileHeader title="Job Offers" />

      <PullToRefresh onRefresh={handleRefresh}>
        <div className="p-4 space-y-4">
          {offers.length === 0 ? (
            <Card className="p-8 text-center">
              <Briefcase className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">No job offers</h3>
              <p className="text-sm text-muted-foreground">
                Check back soon for new opportunities
              </p>
            </Card>
          ) : (
            offers.map((offer) => {
              const expiresIn = formatDistanceToNow(
                new Date(new Date(offer.assigned_at).getTime() + 15 * 60000),
                { addSuffix: true }
              );

              return (
                <Card key={offer.id} className="p-4 space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">
                        {offer.jobs.service_type}
                      </h3>
                      <Badge variant="secondary" className="mt-1">
                        {offer.role}
                      </Badge>
                    </div>
                    <Badge variant="destructive">
                      Expires {expiresIn}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      <span className="flex-1">
                        {offer.jobs.address}, {offer.jobs.city}
                      </span>
                      <span className="text-xs">
                        {offer.distance_miles?.toFixed(1)} mi
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span>
                        {new Date(offer.jobs.start_datetime).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                      <DollarSign className="h-4 w-4" />
                      <span>
                        Estimated: ${(offer.estimated_pay_cents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleResponse(offer.id, false)}
                      disabled={respondingTo === offer.id}
                    >
                      Decline
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={() => handleResponse(offer.id, true)}
                      disabled={respondingTo === offer.id}
                    >
                      Accept Job
                    </Button>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </PullToRefresh>

      <MobileBottomNav />
    </div>
  );
}
