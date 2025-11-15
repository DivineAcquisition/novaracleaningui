import * as React from 'https://esm.sh/react@18.3.1';
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Hr,
} from 'https://esm.sh/@react-email/components@0.0.22';
import { BRAND } from "./brand.ts";

interface CleanerVerificationCodeProps {
  code: string;
  firstName?: string;
}

export const CleanerVerificationCode = ({
  code,
  firstName = "there",
}: CleanerVerificationCodeProps) => {
  return (
    <Html>
      <Head />
      <Preview>Your verification code: {code}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Welcome to {BRAND.name}!</Heading>
          
          <Text style={text}>
            Hi {firstName},
          </Text>
          
          <Text style={text}>
            Thank you for joining our cleaning team! To complete your onboarding, please use the verification code below:
          </Text>

          <Section style={codeContainer}>
            <Text style={codeText}>{code}</Text>
          </Section>

          <Text style={text}>
            This code will expire in 15 minutes.
          </Text>

          <Hr style={hr} />

          <Text style={footer}>
            If you didn't request this code, please ignore this email.
          </Text>

          <Text style={footer}>
            Questions? Contact us at{" "}
            <a href={`mailto:${BRAND.contact.email}`} style={link}>
              {BRAND.contact.email}
            </a>
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export default CleanerVerificationCode;

const main = {
  backgroundColor: BRAND.colors.gray[50],
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "20px 0 48px",
  marginBottom: "64px",
};

const h1 = {
  color: BRAND.colors.gray[900],
  fontSize: "24px",
  fontWeight: "bold",
  margin: "40px 0",
  padding: "0",
  textAlign: "center" as const,
};

const text = {
  color: BRAND.colors.gray[700],
  fontSize: "16px",
  lineHeight: "26px",
  padding: "0 40px",
};

const codeContainer = {
  background: `linear-gradient(135deg, ${BRAND.colors.primary} 0%, ${BRAND.colors.secondary} 100%)`,
  borderRadius: BRAND.borderRadius.lg,
  margin: "32px 40px",
  padding: "24px",
  textAlign: "center" as const,
};

const codeText = {
  color: "#ffffff",
  fontSize: "32px",
  fontWeight: "bold",
  letterSpacing: "8px",
  margin: "0",
  fontFamily: "monospace",
};

const hr = {
  borderColor: BRAND.colors.gray[200],
  margin: "26px 40px",
};

const footer = {
  color: BRAND.colors.gray[600],
  fontSize: "14px",
  lineHeight: "24px",
  padding: "0 40px",
  marginTop: "12px",
};

const link = {
  color: BRAND.colors.primary,
  textDecoration: "underline",
};
