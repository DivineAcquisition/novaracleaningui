import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Calendar, Mail, Home } from "lucide-react";

export default function BookingSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { bookingData, resetBookingData } = useBooking();
  const sessionId = searchParams.get("session_id");

  useEffect(() => {
    // Clear booking data after successful payment
    if (sessionId) {
      console.log("Payment successful, session ID:", sessionId);
    }
  }, [sessionId]);

  const handleReturnHome = () => {
    resetBookingData();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center px-4 py-12">
      <Card className="max-w-2xl w-full shadow-xl border-success/20">
        <CardHeader className="text-center space-y-4 pb-8">
          <div className="mx-auto w-20 h-20 bg-success/10 rounded-full flex items-center justify-center mb-4 animate-in zoom-in duration-500">
            <CheckCircle2 className="w-12 h-12 text-success" />
          </div>
          <CardTitle className="text-4xl font-bold">
            {bookingData.membershipPlan !== 'none' ? 'Welcome to Novara!' : 'Booking Confirmed!'}
          </CardTitle>
          <CardDescription className="text-lg">
            {bookingData.membershipPlan !== 'none' 
              ? 'Your membership is active and your first credit is ready to use'
              : bookingData.useCredit
              ? 'Your booking is confirmed with your membership credit'
              : 'Thank you for choosing Novara Cleaning Service'}
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-8">
          <div className="bg-gradient-to-br from-success/5 to-primary/5 rounded-lg p-6 space-y-4">
            <h3 className="text-xl font-semibold text-center">What happens next?</h3>
            
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Mail className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold mb-1">Confirmation Email</h4>
                  <p className="text-sm text-muted-foreground">
                    We've sent a confirmation email to {bookingData.email} with all your booking details.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Calendar className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold mb-1">Reminder</h4>
                  <p className="text-sm text-muted-foreground">
                    You'll receive a reminder 24 hours before your scheduled cleaning.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Home className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold mb-1">Cleaning Day</h4>
                  <p className="text-sm text-muted-foreground">
                    Our professional team will arrive during your selected time window.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              Need to make changes? Contact us at support@homeglow.com
            </p>
            
            <Button
              size="lg"
              className="h-14 px-8 text-base font-semibold bg-gradient-primary shadow-neon"
              onClick={handleReturnHome}
            >
              Return to Home
            </Button>
          </div>

          {sessionId && (
            <p className="text-center text-xs text-muted-foreground">
              Order ID: {sessionId.slice(-12)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
