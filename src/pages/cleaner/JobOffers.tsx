import {
  RiCheckLine,
  RiCloseLine,
  RiHomeLine,
  RiLoader4Line,
  RiMapPinLine,
  RiTimeLine
} from "@remixicon/react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

import { format } from "date-fns";

interface JobOffer {
  id: string;
  status: string;
  role: string;
  distance_miles: number | null;
  assigned_at: string;
  job_id: string;
  estimated_pay_cents: number | null;
  jobs: {
    service_type: string;
    address: string;
    city: string;
    state: string;
    start_datetime: string;
    duration_est_hours: number;
    sq_ft: number | null;
  };
}

export default function JobOffers() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [offers, setOffers] = useState<JobOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);

  const fetchOffers = async () => {
    if (!user) return;

    try {
      // Get cleaner ID
      const { data: cleaner } = await supabase
        .from("cleaners")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!cleaner) {
        throw new Error("Cleaner profile not found");
      }

      // Get pending offers
      const { data, error } = await (supabase as any)
        .from("job_assignments")
        .select(`
          *,
          jobs (
            service_type,
            address,
            city,
            state,
            start_datetime,
            duration_est_hours,
            sq_ft
          )
        `)
        .eq("cleaner_id", cleaner.id)
        .eq("status", "Offered")
        .order("assigned_at", { ascending: true });

      if (error) throw error;

      setOffers((data as any) || []);
    } catch (error: any) {
      console.error("Error fetching offers:", error);
      // Only show error toast for actual errors, not empty results
      if (error.code !== 'PGRST116') {
        toast({
          title: "Error",
          description: "Failed to load job offers",
          variant: "destructive"
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOffers();

    // Set up real-time subscription for new offers
    const channel = supabase
      .channel('job-offers')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_assignments'
        },
        () => {
          fetchOffers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handleResponse = async (offerId: string, accept: boolean) => {
    setRespondingTo(offerId);

    try {
      const newStatus = accept ? "Confirmed" : "Declined";

      const { error } = await (supabase as any)
        .from("job_assignments")
        .update({
          status: newStatus,
          responded_at: new Date().toISOString()
        })
        .eq("id", offerId);

      if (error) throw error;

      toast({
        title: accept ? "Offer Accepted" : "Offer Declined",
        description: accept 
          ? "You've been confirmed for this job"
          : "The offer has been declined"
      });

      fetchOffers();

      // Update cleaner scores after acceptance
      if (accept) {
        await supabase.functions.invoke("update-cleaner-scores", {
          body: {}
        });
      }
    } catch (error: any) {
      console.error("Response error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to respond to offer",
        variant: "destructive"
      });
    } finally {
      setRespondingTo(null);
    }
  };

  const getOfferExpiry = (assignedAt: string) => {
    const assigned = new Date(assignedAt);
    const expiry = new Date(assigned.getTime() + 15 * 60 * 1000); // 15 minutes
    const now = new Date();
    const minutesLeft = Math.floor((expiry.getTime() - now.getTime()) / 60000);

    if (minutesLeft <= 0) return "Expired";
    return `${minutesLeft} min left`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <RiLoader4Line className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Job Offers</h1>
          <p className="text-muted-foreground">
            Review and respond to job assignments
          </p>
        </div>

        {offers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <RiTimeLine className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-lg font-medium">No job offers at the moment</p>
              <p className="text-sm text-muted-foreground">
                Check back soon for new opportunities!
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {offers.map((offer) => (
              <Card key={offer.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {offer.jobs.service_type}
                        <Badge variant={offer.role === "Lead" ? "default" : "secondary"}>
                          {offer.role}
                        </Badge>
                      </CardTitle>
                      <CardDescription>
                        {format(new Date(offer.jobs.start_datetime), "EEEE, MMMM d 'at' h:mm a")}
                      </CardDescription>
                    </div>
                    <Badge variant="outline">
                      {getOfferExpiry(offer.assigned_at)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex items-center gap-2">
                      <RiMapPinLine className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{offer.jobs.city}, {offer.jobs.state}</p>
                        <p className="text-xs text-muted-foreground">
                          {offer.distance_miles.toFixed(1)} miles away
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <RiHomeLine className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{offer.jobs.sq_ft} sq ft</p>
                        <p className="text-xs text-muted-foreground">Property size</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <RiTimeLine className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{offer.jobs.duration_est_hours} hours</p>
                        <p className="text-xs text-muted-foreground">Estimated duration</p>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm font-medium">Estimated Pay</p>
                    <p className="text-2xl font-bold text-primary">
                      ${(offer.jobs.duration_est_hours * 18).toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      $18/hour × {offer.jobs.duration_est_hours} hours
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <Button
                      onClick={() => handleResponse(offer.id, true)}
                      disabled={respondingTo === offer.id}
                      className="flex-1"
                    >
                      {respondingTo === offer.id ? (
                        <RiLoader4Line className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <RiCheckLine className="h-4 w-4 mr-2" />
                          Accept Job
                        </>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => handleResponse(offer.id, false)}
                      disabled={respondingTo === offer.id}
                      className="flex-1"
                    >
                      <RiCloseLine className="h-4 w-4 mr-2" />
                      Decline
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
