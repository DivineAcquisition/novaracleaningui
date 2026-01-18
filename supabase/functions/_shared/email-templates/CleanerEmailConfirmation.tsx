import * as React from "react";
import { EmailLayout } from "./components/EmailLayout";
import { Button } from "./components/Button";
import { Text, Section, Hr } from "@react-email/components";
import { BRAND } from "./brand";

interface CleanerEmailConfirmationProps {
  firstName?: string;
  confirmationUrl?: string;
}

export function CleanerEmailConfirmation({
  firstName = "there",
  confirmationUrl = "#",
}: CleanerEmailConfirmationProps) {
  return (
    <EmailLayout previewText="Verify your email to join Novara Cleaning">
      <Section style={styles.heroSection}>
        <Text style={styles.emoji}>✉️</Text>
        <Text style={styles.headline}>Verify Your Email</Text>
        <Text style={styles.subheadline}>
          Hi {firstName}! Click below to confirm your email and start your onboarding with Novara Cleaning.
        </Text>
      </Section>

      <Section style={styles.ctaSection}>
        <Button href={confirmationUrl}>
          Verify Email & Get Started
        </Button>
      </Section>

      <Hr style={styles.divider} />

      <Section style={styles.stepsSection}>
        <Text style={styles.stepsTitle}>What's Next?</Text>
        <div style={styles.stepsList}>
          <Text style={styles.step}>
            <span style={styles.stepNumber}>1</span>
            Verify your email (this step)
          </Text>
          <Text style={styles.step}>
            <span style={styles.stepNumber}>2</span>
            Complete your profile
          </Text>
          <Text style={styles.step}>
            <span style={styles.stepNumber}>3</span>
            Set up your payment account
          </Text>
          <Text style={styles.step}>
            <span style={styles.stepNumber}>4</span>
            Start receiving jobs!
          </Text>
        </div>
      </Section>

      <Hr style={styles.divider} />

      <Section style={styles.benefitsSection}>
        <Text style={styles.benefitsTitle}>Why Join Novara?</Text>
        <Text style={styles.benefit}>💰 Earn $18-25/hour with tips</Text>
        <Text style={styles.benefit}>📅 Flexible scheduling - work when you want</Text>
        <Text style={styles.benefit}>⚡ Get paid within 24 hours of job completion</Text>
        <Text style={styles.benefit}>📍 Local jobs in your area</Text>
      </Section>

      <Section style={styles.footerSection}>
        <Text style={styles.footerText}>
          If you didn't create an account with Novara Cleaning, you can safely ignore this email.
        </Text>
        <Text style={styles.footerText}>
          Questions? Contact us at{" "}
          <a href="mailto:hello@novaracleaning.com" style={styles.link}>
            hello@novaracleaning.com
          </a>
        </Text>
      </Section>
    </EmailLayout>
  );
}

const styles = {
  heroSection: {
    textAlign: "center" as const,
    padding: "30px 20px",
  },
  emoji: {
    fontSize: "48px",
    marginBottom: "10px",
  },
  headline: {
    fontSize: "28px",
    fontWeight: "bold" as const,
    color: "#1a1a1a",
    margin: "15px 0",
  },
  subheadline: {
    fontSize: "16px",
    color: "#666",
    margin: "0",
    lineHeight: "1.5",
  },
  ctaSection: {
    textAlign: "center" as const,
    padding: "20px 0 30px",
  },
  divider: {
    borderColor: "#e5e5e5",
    margin: "20px 0",
  },
  stepsSection: {
    padding: "20px",
    backgroundColor: "#f9f9f9",
    borderRadius: "12px",
    margin: "0 20px",
  },
  stepsTitle: {
    fontSize: "16px",
    fontWeight: "600" as const,
    color: "#1a1a1a",
    marginBottom: "15px",
    textAlign: "center" as const,
  },
  stepsList: {
    margin: "0",
  },
  step: {
    fontSize: "14px",
    color: "#666",
    margin: "10px 0",
    display: "flex" as const,
    alignItems: "center" as const,
  },
  stepNumber: {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    width: "24px",
    height: "24px",
    backgroundColor: BRAND.colors.primary,
    color: "#fff",
    borderRadius: "50%",
    fontSize: "12px",
    fontWeight: "bold" as const,
    marginRight: "10px",
  },
  benefitsSection: {
    padding: "20px",
  },
  benefitsTitle: {
    fontSize: "16px",
    fontWeight: "600" as const,
    color: "#1a1a1a",
    marginBottom: "15px",
    textAlign: "center" as const,
  },
  benefit: {
    fontSize: "14px",
    color: "#666",
    margin: "8px 0",
    paddingLeft: "10px",
  },
  footerSection: {
    padding: "20px",
    textAlign: "center" as const,
  },
  footerText: {
    fontSize: "12px",
    color: "#999",
    margin: "5px 0",
  },
  link: {
    color: BRAND.colors.primary,
    textDecoration: "none",
  },
};

export default CleanerEmailConfirmation;
