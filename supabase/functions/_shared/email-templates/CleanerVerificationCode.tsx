import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section } from 'https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1,react-dom@18.3.1';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Highlight } from './components/Highlight.tsx';
import { BRAND } from './brand.ts';

interface CleanerVerificationCodeProps {
  code: string;
  firstName?: string;
}

export const CleanerVerificationCode = ({
  code,
  firstName = "there",
}: CleanerVerificationCodeProps) => {
  return (
    <EmailLayout
      title="🧹 Welcome to the Team!"
      subtitle="Verify your email to get started"
      previewText={`Your verification code: ${code}`}
      footerNote="If you didn't request this code, please ignore this email."
    >
      <Text style={paragraph}>Hi {firstName},</Text>
      
      <Text style={paragraph}>
        Thank you for joining the <strong>Novara Cleaning team</strong>! We're excited to have you onboard as a professional cleaner.
      </Text>

      <Text style={paragraph}>
        To complete your registration and start accepting jobs, please enter this 6-digit verification code:
      </Text>

      <Section style={codeContainer}>
        <Text style={codeText}>{code}</Text>
      </Section>

      <Highlight variant="warning">
        <Text style={expiryText}>
          ⏰ <strong>This code expires in 15 minutes</strong>
        </Text>
        <Text style={expirySubtext}>
          Enter the code in the app to continue with your onboarding.
        </Text>
      </Highlight>

      <Text style={paragraph}>
        Once verified, you'll be able to:
      </Text>

      <ul style={listStyle}>
        <li>Complete your professional profile</li>
        <li>Set your availability and service area</li>
        <li>Start accepting cleaning jobs</li>
        <li>Earn competitive pay with flexible hours</li>
      </ul>

      <Text style={paragraph}>
        Questions about getting started? Our team is here to help at{' '}
        <a href={`mailto:${BRAND.contact.email}`} style={link}>
          {BRAND.contact.email}
        </a>
      </Text>

      <Text style={signature}>
        Welcome aboard!
        <br />
        <strong>The Novara Team</strong>
      </Text>
    </EmailLayout>
  );
};

export default CleanerVerificationCode;

// Styles
const paragraph = {
  margin: '16px 0',
  fontSize: '16px',
  lineHeight: '1.6',
  color: BRAND.colors.gray[700],
};

const codeContainer = {
  background: BRAND.gradient.primary,
  borderRadius: BRAND.borderRadius.lg,
  margin: '32px 0',
  padding: '32px',
  textAlign: 'center' as const,
  boxShadow: '0 4px 12px rgba(139, 92, 246, 0.2)',
};

const codeText = {
  color: '#ffffff',
  fontSize: '40px',
  fontWeight: 'bold',
  letterSpacing: '12px',
  margin: '0',
  fontFamily: 'Courier, monospace',
};

const expiryText = {
  margin: '0 0 8px 0',
  fontSize: '16px',
  color: BRAND.colors.gray[900],
};

const expirySubtext = {
  margin: '0',
  fontSize: '14px',
  color: BRAND.colors.gray[600],
};

const listStyle = {
  margin: '8px 0 16px 0',
  paddingLeft: '24px',
  color: BRAND.colors.gray[700],
  fontSize: '16px',
  lineHeight: '1.8',
};

const link = {
  color: BRAND.colors.primary,
  textDecoration: 'none',
  fontWeight: '600',
};

const signature = {
  margin: '32px 0 0 0',
  fontSize: '16px',
  color: BRAND.colors.gray[700],
  lineHeight: '1.6',
};
