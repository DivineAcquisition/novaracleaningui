import * as React from "https://esm.sh/react@18.3.1";
import { Text, Section } from "https://esm.sh/@react-email/components@0.0.22";
import { EmailLayout } from "./components/EmailLayout.tsx";
import { Highlight } from "./components/Highlight.tsx";
import { Button } from "./components/Button.tsx";
import { BRAND } from "./brand.ts";

interface CleanerTierPromotionProps {
  firstName: string;
  previousTier: string;
  newTier: string;
  previousPercentage: number;
  newPercentage: number;
  dashboardUrl?: string;
}

const titleCase = (s: string) =>
  String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());

export const CleanerTierPromotion = ({
  firstName,
  previousTier,
  newTier,
  previousPercentage,
  newPercentage,
  dashboardUrl = "https://contractor.novaracleaning.com/cleaner",
}: CleanerTierPromotionProps) => {
  return (
    <EmailLayout
      title={`You're now ${titleCase(newTier)}!`}
      subtitle="Your pay share just went up"
      previewText={`Congratulations — you're now on the ${titleCase(newTier)} tier at ${newPercentage}% revenue share.`}
      footerNote="Your new rate applies to jobs offered after this promotion. Past jobs keep their original pay."
    >
      <Text style={paragraph}>Hi {firstName || "there"},</Text>

      <Text style={paragraph}>
        Great news — you've been promoted to the{" "}
        <strong>{titleCase(newTier)}</strong> pay tier. Your share of job revenue
        is now higher on every new job you're offered.
      </Text>

      <Highlight variant="info">
        <Section style={rateBox}>
          <Text style={rateLabel}>Previous</Text>
          <Text style={rateValueMuted}>
            {titleCase(previousTier)} · {previousPercentage}%
          </Text>
          <Text style={{ ...rateLabel, marginTop: "16px" }}>New rate</Text>
          <Text style={rateValue}>
            {titleCase(newTier)} · {newPercentage}%
          </Text>
        </Section>
      </Highlight>

      <Text style={paragraph}>
        That means on a $200 clean, your crew pool moves from $
        {((200 * previousPercentage) / 100).toFixed(0)} to $
        {((200 * newPercentage) / 100).toFixed(0)} before the team split —
        more money for the same work.
      </Text>

      <Section style={{ textAlign: "center", margin: "28px 0" }}>
        <Button href={dashboardUrl}>Open contractor portal</Button>
      </Section>

      <Text style={paragraph}>
        Keep showing up, keep the photos sharp, and keep clients happy — that's
        how tiers climb. Congrats again.
      </Text>

      <Text style={paragraph}>
        — The Novara Cleaning Team
      </Text>
    </EmailLayout>
  );
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "24px",
  color: BRAND.colors.gray[700],
  marginBottom: "16px",
};

const rateBox = {
  margin: "0",
};

const rateLabel = {
  fontSize: "12px",
  letterSpacing: "0.04em",
  textTransform: "uppercase" as const,
  color: BRAND.colors.gray[500],
  margin: "0 0 4px 0",
};

const rateValue = {
  fontSize: "22px",
  fontWeight: 700,
  color: BRAND.colors.gray[900],
  margin: "0",
};

const rateValueMuted = {
  fontSize: "16px",
  fontWeight: 600,
  color: BRAND.colors.gray[600],
  margin: "0",
  textDecoration: "line-through",
};
