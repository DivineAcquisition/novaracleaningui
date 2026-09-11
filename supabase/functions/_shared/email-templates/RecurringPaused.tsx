import * as React from "https://esm.sh/react@18.3.1";
import { Text, Section } from "https://esm.sh/@react-email/components@0.0.22";
import { EmailLayout } from "./components/EmailLayout.tsx";
import { Highlight } from "./components/Highlight.tsx";
import { BRAND } from "./brand.ts";

interface RecurringPausedProps {
  name?: string;
  reason?: string;
  cadence?: string;
}

export const RecurringPaused = (props: RecurringPausedProps) => {
  const name = props.name || "there";
  const reason = (props.reason || "").trim();
  const cadence = (props.cadence || "").trim();

  return (
    <EmailLayout
      title="Recurring cleaning paused"
      subtitle="We'll be in touch when we're ready to resume"
      previewText={reason || "Your Novara recurring cleaning is paused"}
      footerNote="This pause stops automatic booking. It does not cancel already-scheduled visits or change Glow billing on its own."
    >
      <Text style={paragraph}>Hi {name},</Text>
      <Text style={paragraph}>
        We've paused your{cadence ? ` ${cadence}` : ""} recurring cleaning.
      </Text>

      {reason ? (
        <Highlight variant="warning">
          <Text style={reasonText}>{reason}</Text>
        </Highlight>
      ) : null}

      <Text style={paragraph}>
        We won't auto-book your next visit until this is resolved. We'll reach out when we're ready to get you back on the schedule.
      </Text>

      <Text style={paragraph}>
        Questions? Call {BRAND.contact.phone} or email{" "}
        <a href={`mailto:${BRAND.contact.email}`} style={link}>
          {BRAND.contact.email}
        </a>
        .
      </Text>

      <Section>
        <Text style={signature}>
          — The Novara Team
        </Text>
      </Section>
    </EmailLayout>
  );
};

const paragraph = {
  margin: "16px 0",
  fontSize: "16px",
  lineHeight: "1.6",
  color: BRAND.colors.gray[700],
};

const reasonText = {
  margin: "0",
  fontSize: "16px",
  lineHeight: "1.6",
  color: BRAND.colors.gray[900],
  fontWeight: "600" as const,
};

const link = {
  color: BRAND.colors.primary,
  textDecoration: "underline",
};

const signature = {
  margin: "24px 0 0 0",
  fontSize: "16px",
  color: BRAND.colors.gray[700],
};

export default RecurringPaused;
