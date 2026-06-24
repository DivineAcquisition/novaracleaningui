import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Clock, DollarSign, ExternalLink } from "lucide-react";
import { format } from "date-fns";

interface UpcomingJobsProps {
  jobs: any[];
}

export function UpcomingJobs({ jobs }: UpcomingJobsProps) {
  if (jobs.length === 0) {
    return (
      <div className="text-center py-8">
        <Clock className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">No upcoming jobs scheduled</p>
      </div>
    );
  }

  const getGoogleMapsUrl = (address: string, city: string, state: string, zip: string) => {
    const fullAddress = `${address}, ${city}, ${state} ${zip}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
  };

  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <Card key={job.id} className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-semibold text-base">{job.service_type}</h3>
              <p className="text-xs text-muted-foreground">{job.role}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-base text-primary">
                ${(job.estimated_pay_cents / 100).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">estimated pay</p>
            </div>
          </div>

          <div className="space-y-1.5 mb-3">
            <div className="flex items-center gap-2 text-xs">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span>
                {format(new Date(job.start_datetime), "EEEE, MMMM d 'at' h:mm a")}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{job.address}, {job.city}, {job.state}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{job.duration_est_hours} hours estimated</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => window.open(getGoogleMapsUrl(job.address, job.city, job.state, job.zip), '_blank')}
            >
              <MapPin className="mr-2 w-3.5 h-3.5" />
              Get Directions
            </Button>
            {/* Check-in functionality can be added based on time window */}
          </div>
        </Card>
      ))}
    </div>
  );
}
