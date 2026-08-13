import * as React from "https://esm.sh/react@18.3.1";
import { Html, Head, Body, Container, Section, Text, Heading } from "https://esm.sh/@react-email/components@0.0.22";
import { EmailLayout } from "./components/EmailLayout.tsx";
import { DetailRow } from "./components/DetailRow.tsx";
import { Highlight } from "./components/Highlight.tsx";
import { BRAND } from "./brand.ts";

interface PayoutConfirmationProps {
  cleanerFirstName: string;
  bookingId: string;
  amount: number;
  transferId: string;
  transferDate: string;
  bookingLabel?: string;
  cleanerFullName?: string;
  sourceLabel?: string;
}

export const PayoutConfirmation = ({
  cleanerFirstName,
  bookingId,
  amount,
  transferId,
  transferDate,
  bookingLabel,
  cleanerFullName,
  sourceLabel,
}: PayoutConfirmationProps) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Html>
      <Head />
      <EmailLayout title="Payment Sent" previewText="Payment Sent Successfully">
        <Heading style={styles.heading}>
          Payment Sent! 💸
        </Heading>

        <Text style={styles.paragraph}>
          Hi {cleanerFirstName},
        </Text>

        <Text style={styles.paragraph}>
          Good news! Your payout has been sent to your Stripe Connect account.
        </Text>

        <Section style={styles.highlightSection}>
          <Highlight>
            <Text style={styles.highlightText}>
              <strong>Payment Details</strong>
            </Text>
            {cleanerFullName ? <DetailRow label="Contractor" value={cleanerFullName} /> : null}
            <DetailRow label="Job" value={bookingLabel || (bookingId ? bookingId.substring(0, 8) : "—")} />
            {sourceLabel ? <DetailRow label="Type" value={sourceLabel} /> : null}
            <DetailRow label="Amount" value={`$${(amount / 100).toFixed(2)}`} />
            <DetailRow label="Transfer Date" value={formatDate(transferDate)} />
            <DetailRow label="Stripe Transfer ID" value={transferId} />
          </Highlight>
        </Section>

        <Text style={styles.paragraph}>
          The funds should appear in your connected bank account within 2–3 business days, depending on your bank's processing time.
        </Text>

        <Text style={styles.paragraph}>
          <strong>Need help?</strong> If you have any questions about this payment or don't see the funds in your account after 3 business days, please contact our support team.
        </Text>

        <Text style={styles.footer}>
          Thank you for being part of the Novara team!<br />
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

export default PayoutConfirmation;
