import * as React from "https://esm.sh/react@18.3.1";
import { Html, Head, Body, Container, Section, Text, Heading, Button } from "https://esm.sh/@react-email/components@0.0.22";
import { EmailLayout } from "./components/EmailLayout.tsx";
import { DetailRow } from "./components/DetailRow.tsx";
import { Highlight } from "./components/Highlight.tsx";
import { BRAND } from "./brand.ts";

interface CleanerInvitationProps {
  firstName: string;
  lastName: string;
  email: string;
  onboardingUrl: string;
}

export const CleanerInvitation = ({
  firstName,
  lastName,
  email,
  onboardingUrl,
}: CleanerInvitationProps) => {
  return (
    <Html>
      <Head />
      <EmailLayout title="Welcome to Novara Cleaning" previewText="Welcome to the Novara Cleaning Team!">
        <Heading style={styles.heading}>
          Welcome to Novara Cleaning! 🎉
        </Heading>

        <Text style={styles.paragraph}>
          Hi {firstName},
        </Text>

        <Text style={styles.paragraph}>
          We're excited to have you join our team of professional cleaners! You've been invited to become part of Novara Cleaning's network of trusted professionals.
        </Text>

        <Section style={styles.highlightSection}>
          <Highlight>
            <Text style={styles.highlightText}>
              <strong>Your Account Details</strong>
            </Text>
            <DetailRow label="Name" value={`${firstName} ${lastName}`} />
            <DetailRow label="Email" value={email} />
          </Highlight>
        </Section>

        <Text style={styles.paragraph}>
          <strong>Next Steps:</strong>
        </Text>

        <Text style={styles.listItem}>
          1. Complete your Stripe Connect onboarding to receive payouts
        </Text>
        <Text style={styles.listItem}>
          2. Set up your profile and service areas
        </Text>
        <Text style={styles.listItem}>
          3. Start receiving booking assignments
        </Text>

        <Section style={styles.buttonSection}>
          <Button href={onboardingUrl} style={styles.button}>
            Complete Onboarding
          </Button>
        </Section>

        <Text style={styles.paragraph}>
          Once you complete the onboarding process, you'll be able to:
        </Text>

        <Text style={styles.listItem}>
          ✓ Receive automatic booking assignments
        </Text>
        <Text style={styles.listItem}>
          ✓ View your upcoming jobs
        </Text>
        <Text style={styles.listItem}>
          ✓ Track your earnings
        </Text>
        <Text style={styles.listItem}>
          ✓ Get paid automatically after each completed service
        </Text>

        <Text style={styles.paragraph}>
          If you have any questions, please don't hesitate to reach out to our team.
        </Text>

        <Text style={styles.footer}>
          Welcome aboard!<br />
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

export default CleanerInvitation;
