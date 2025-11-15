import { Card } from "@/components/ui/card";
import { MapPin, Calendar, DollarSign, Star } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

interface CompletedJobsProps {
  jobs: any[];
}

export function CompletedJobs({ jobs }: CompletedJobsProps) {
  if (jobs.length === 0) {
    return (
      <div className="text-center py-8">
        <DollarSign className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">No completed jobs yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Your completed jobs will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((booking) => (
        <Card key={booking.id} className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-semibold text-base">{booking.service_type}</h3>
              <p className="text-xs text-muted-foreground">
                {booking.first_name} {booking.last_name}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-base text-green-600">
                ${(booking.cleaner_payout_cents / 100).toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground">earned</p>
            </div>
          </div>

          <div className="space-y-1.5 mb-3">
            <div className="flex items-center gap-2 text-xs">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <span>
                {format(new Date(booking.service_date), "MMMM d, yyyy")}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{booking.address}, {booking.city}</span>
            </div>
            {booking.estimated_duration_hours && (
              <div className="flex items-center gap-2 text-xs">
                <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                <span>{booking.estimated_duration_hours} hours × ${booking.cleaner_hourly_rate_cents / 100}/hr</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Badge variant={booking.payout_status === 'completed' ? 'default' : 'secondary'} className="text-xs">
              {booking.payout_status || 'pending'}
            </Badge>
            {booking.rating_submitted && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                <span>Rated by customer</span>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
