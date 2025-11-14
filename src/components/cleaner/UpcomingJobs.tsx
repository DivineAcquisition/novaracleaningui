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
      <div className="text-center py-12">
        <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-muted-foreground">No upcoming jobs scheduled</p>
      </div>
    );
  }

  const getGoogleMapsUrl = (address: string, city: string, state: string, zip: string) => {
    const fullAddress = `${address}, ${city}, ${state} ${zip}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
  };

  return (
    <div className="space-y-4">
      {jobs.map((job) => (
        <Card key={job.id} className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-semibold text-lg">{job.service_type}</h3>
              <p className="text-sm text-muted-foreground">{job.role}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-lg text-primary">
                ${(job.estimated_pay_cents / 100).toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground">estimated pay</p>
            </div>
          </div>

          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span>
                {format(new Date(job.start_datetime), "EEEE, MMMM d 'at' h:mm a")}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span>{job.address}, {job.city}, {job.state}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <span>{job.duration_est_hours} hours estimated</span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => window.open(getGoogleMapsUrl(job.address, job.city, job.state, job.zip), '_blank')}
            >
              <MapPin className="mr-2 w-4 h-4" />
              Get Directions
            </Button>
            {/* Check-in functionality can be added based on time window */}
          </div>
        </Card>
      ))}
    </div>
  );
}
