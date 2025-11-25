import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import logo from "@/assets/logo.png";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gradient-hero py-12 px-4">
      <div className="container max-w-4xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <Link to="/">
            <img src={logo} alt="NovaraCleaning Logo" className="w-16 h-16 rounded-2xl shadow-lavender" />
          </Link>
          <Link to="/">
            <Button variant="outline">
              <ArrowLeft className="mr-2 w-4 h-4" />
              Back to Home
            </Button>
          </Link>
        </div>

        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle className="text-3xl font-bold">Terms of Service</CardTitle>
            <p className="text-sm text-muted-foreground">Last updated: January 2025</p>
          </CardHeader>
          <CardContent className="prose prose-sm max-w-none">
            <h2 className="text-2xl font-semibold mt-6 mb-4">1. Agreement to Terms</h2>
            <p className="mb-4">
              By accessing or using NovaraCleaning services, you agree to be bound by these Terms of Service and all
              applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from
              using our services.
            </p>

            <h2 className="text-2xl font-semibold mt-6 mb-4">2. Service Description</h2>
            <p className="mb-4">
              NovaraCleaning provides residential and commercial cleaning services. We reserve the right to modify,
              suspend, or discontinue any part of our services at any time without notice.
            </p>

            <h2 className="text-2xl font-semibold mt-6 mb-4">3. Booking and Payment</h2>
            <p className="mb-4">
              All bookings must be made through our website or authorized channels. Payment is required at the time of
              booking. We accept credit cards and other payment methods as indicated on our platform.
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>Deposits are non-refundable unless cancelled more than 48 hours before the scheduled service</li>
              <li>Full payment is due upon completion of service</li>
              <li>Late cancellations may incur a cancellation fee</li>
            </ul>

            <h2 className="text-2xl font-semibold mt-6 mb-4">4. Cancellation and Rescheduling</h2>
            <p className="mb-4">
              You may cancel or reschedule your booking up to 48 hours before the scheduled service time without
              penalty. Cancellations made less than 48 hours in advance may forfeit the deposit.
            </p>

            <h2 className="text-2xl font-semibold mt-6 mb-4">5. Customer Responsibilities</h2>
            <p className="mb-4">
              You agree to:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>Provide accurate and complete information</li>
              <li>Ensure access to the property at the scheduled time</li>
              <li>Secure valuable and fragile items before service</li>
              <li>Inform us of any special requirements or hazards</li>
            </ul>

            <h2 className="text-2xl font-semibold mt-6 mb-4">6. Liability</h2>
            <p className="mb-4">
              NovaraCleaning carries liability insurance. However, we are not responsible for:
            </p>
            <ul className="list-disc pl-6 mb-4">
              <li>Pre-existing damage to property</li>
              <li>Damage resulting from customer negligence</li>
              <li>Items not properly secured before service</li>
            </ul>

            <h2 className="text-2xl font-semibold mt-6 mb-4">7. Membership Terms</h2>
            <p className="mb-4">
              Membership plans are billed monthly and renew automatically. Credits expire at the end of each billing
              cycle and cannot be transferred or refunded. You may cancel your membership at any time, effective at
              the end of the current billing period.
            </p>

            <h2 className="text-2xl font-semibold mt-6 mb-4">8. Contact Us</h2>
            <p className="mb-4">
              If you have questions about these Terms of Service, please contact us at:
            </p>
            <p className="mb-4">
              Email: support@novaracleaning.com<br />
              Phone: (555) 123-4567
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
