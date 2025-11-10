import * as React from "https://esm.sh/react@18.3.1";
import { Html, Head, Body, Container, Section, Text, Heading, Button } from "https://esm.sh/@react-email/components@0.0.22";
import { EmailLayout } from "./components/EmailLayout.tsx";
import { DetailRow } from "./components/DetailRow.tsx";
import { Highlight } from "./components/Highlight.tsx";
import { BRAND } from "./brand.ts";

interface CleanerAssignmentProps {
  cleanerFirstName: string;
  bookingId: string;
  customerName: string;
  serviceDate: string;
  timeSlot: string;
  serviceType: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  estimatedEarnings: number;
  dashboardUrl: string;
}

export const CleanerAssignment = ({
  cleanerFirstName,
  bookingId,
  customerName,
  serviceDate,
  timeSlot,
  serviceType,
  address,
  city,
  state,
  zipCode,
  estimatedEarnings,
  dashboardUrl,
}: CleanerAssignmentProps) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatServiceType = (type: string) => {
    const types: Record<string, string> = {
      standard: "Standard Cleaning",
      deep: "Deep Cleaning",
      moveInOut: "Move In/Out Cleaning",
    };
    return types[type] || type;
  };

  const formatTimeSlot = (slot: string) => {
    const slots: Record<string, string> = {
      morning: "8:00 AM - 12:00 PM",
      afternoon: "12:00 PM - 4:00 PM",
      evening: "4:00 PM - 8:00 PM",
    };
    return slots[slot] || slot;
  };

  return (
    <Html>
      <Head />
      <EmailLayout title="New Booking Assignment" previewText="New Booking Assignment">
        <Heading style={styles.heading}>
          New Booking Assignment 📋
        </Heading>

        <Text style={styles.paragraph}>
          Hi {cleanerFirstName},
        </Text>

        <Text style={styles.paragraph}>
          You've been assigned a new cleaning job! Here are the details:
        </Text>

        <Section style={styles.highlightSection}>
          <Highlight>
            <Text style={styles.highlightText}>
              <strong>Booking Details</strong>
            </Text>
            <DetailRow label="Booking ID" value={bookingId.substring(0, 8)} />
            <DetailRow label="Customer" value={customerName} />
            <DetailRow label="Service Date" value={formatDate(serviceDate)} />
            <DetailRow label="Time Window" value={formatTimeSlot(timeSlot)} />
            <DetailRow label="Service Type" value={formatServiceType(serviceType)} />
            <DetailRow
              label="Location"
              value={`${address}, ${city}, ${state} ${zipCode}`}
            />
            <DetailRow
              label="Your Earnings"
              value={`$${(estimatedEarnings / 100).toFixed(2)}`}
            />
          </Highlight>
        </Section>

        <Text style={styles.paragraph}>
          <strong>What to bring:</strong>
        </Text>

        <Text style={styles.listItem}>
          ✓ All necessary cleaning supplies
        </Text>
        <Text style={styles.listItem}>
          ✓ Professional attitude and appearance
        </Text>
        <Text style={styles.listItem}>
          ✓ Your Novara Cleaning ID badge
        </Text>

        <Section style={styles.buttonSection}>
          <Button href={dashboardUrl} style={styles.button}>
            View in Dashboard
          </Button>
        </Section>

        <Text style={styles.paragraph}>
          Please arrive on time and complete the service to our high standards. Your payout will be processed automatically after the booking is marked complete.
        </Text>

        <Text style={styles.footer}>
          Good luck with your job!<br />
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
  listItem: {
    fontSize: "16px",
    lineHeight: "24px",
    color: "#374151",
    marginBottom: "8px",
    paddingLeft: "16px",
  },
  buttonSection: {
    textAlign: "center" as const,
    margin: "32px 0",
  },
  button: {
    backgroundColor: BRAND.colors.primary,
    color: "#ffffff",
    padding: "14px 28px",
    borderRadius: "8px",
    textDecoration: "none",
    fontWeight: "600",
    fontSize: "16px",
    display: "inline-block",
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

export default CleanerAssignment;
