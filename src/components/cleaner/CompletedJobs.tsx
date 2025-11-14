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
      <div className="text-center py-12">
        <DollarSign className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-muted-foreground">No completed jobs yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Your completed jobs will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {jobs.map((booking) => (
        <Card key={booking.id} className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-semibold">{booking.service_type}</h3>
              <p className="text-sm text-muted-foreground">
                {booking.first_name} {booking.last_name}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-lg text-green-600">
                ${(booking.cleaner_payout_cents / 100).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">earned</p>
            </div>
          </div>

          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span>
                {format(new Date(booking.service_date), "MMMM d, yyyy")}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span>{booking.address}, {booking.city}</span>
            </div>
            {booking.estimated_duration_hours && (
              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="w-4 h-4 text-muted-foreground" />
                <span>{booking.estimated_duration_hours} hours × ${booking.cleaner_hourly_rate_cents / 100}/hr</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Badge variant={booking.payout_status === 'completed' ? 'default' : 'secondary'}>
              {booking.payout_status || 'pending'}
            </Badge>
            {booking.rating_submitted && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                <span>Rated by customer</span>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
