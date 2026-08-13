import * as React from "https://esm.sh/react@18.3.1";
import { Html, Head, Body, Container, Section, Text, Heading } from "https://esm.sh/@react-email/components@0.0.22";
import { EmailLayout } from "./components/EmailLayout.tsx";
import { DetailRow } from "./components/DetailRow.tsx";
import { Highlight } from "./components/Highlight.tsx";
import { BRAND } from "./brand.ts";

interface BookingCompletionProps {
  cleanerFirstName: string;
  bookingId: string;
  serviceDate: string;
  customerName: string;
  earnings: number;
  payoutStatus: string;
}

export const BookingCompletion = ({
  cleanerFirstName,
  bookingId,
  serviceDate,
  customerName,
  earnings,
  payoutStatus,
}: BookingCompletionProps) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <Html>
      <Head />
      <EmailLayout title="Booking Completed" previewText="Booking Marked Complete">
        <Heading style={styles.heading}>
          Booking Completed! ✅
        </Heading>

        <Text style={styles.paragraph}>
          Hi {cleanerFirstName},
        </Text>

        <Text style={styles.paragraph}>
          Great work! Your booking has been marked as complete by our admin team.
        </Text>

        <Section style={styles.highlightSection}>
          <Highlight>
            <Text style={styles.highlightText}>
              <strong>Completed Booking</strong>
            </Text>
            <DetailRow label="Booking ID" value={bookingId.substring(0, 8)} />
            <DetailRow label="Customer" value={customerName} />
            <DetailRow label="Service Date" value={formatDate(serviceDate)} />
            <DetailRow label="Suggested pay" value={`$${(earnings / 100).toFixed(2)}`} />
            <DetailRow
              label="Payout Status"
              value={
                payoutStatus === "pending_confirmation"
                  ? "Pending confirmation"
                  : payoutStatus === "processing"
                    ? "Processing..."
                    : "Initiated"
              }
            />
          </Highlight>
        </Section>

        <Text style={styles.paragraph}>
          {payoutStatus === "pending_confirmation"
            ? "We'll email you when your Stripe Connect payout is confirmed and sent."
            : payoutStatus === "processing"
              ? "Your payout is being processed and will be transferred to your connected Stripe account shortly."
              : "Your payout has been initiated and should arrive in your bank account within 2-3 business days."}
        </Text>

        <Text style={styles.paragraph}>
          You can track your earnings and payout history in your cleaner dashboard.
        </Text>

        <Text style={styles.footer}>
          Thank you for your excellent service!<br />
          The Novara Cleaning Team
        </Text>
      </EmailLayout>
    </Html>
  );
};

const styles = {
  heading: {
    fontSize: "28px",
    fontWeight: "bold",
    color: BRAND.colors.primary,
    marginBottom: "24px",
    textAlign: "center" as const,
  },
  paragraph: {
    fontSize: "16px",
    lineHeight: "24px",
    color: "#374151",
    marginBottom: "16px",
  },
  highlightSection: {
    margin: "32px 0",
  },
  highlightText: {
    fontSize: "18px",
    color: BRAND.colors.primary,
    marginBottom: "16px",
  },
  footer: {
    fontSize: "16px",
    lineHeight: "24px",
    color: "#6B7280",
    marginTop: "32px",
    paddingTop: "24px",
    borderTop: "1px solid #E5E7EB",
  },
};

export default BookingCompletion;
