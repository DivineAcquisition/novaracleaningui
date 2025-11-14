import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { BRAND } from './brand.ts';

interface CreditExpiryWarningProps {
  name?: string;
  plan?: string;
  credits?: number;
  expiryDate?: string;
}

export const CreditExpiryWarning = (props: CreditExpiryWarningProps) => {
  return (
    <EmailLayout
      title="Your Credits Are Expiring Soon!"
      subtitle="Don't let your credits go to waste"
      previewText={`${props.credits} credit${props.credits !== 1 ? 's' : ''} expiring soon`}
      footerNote="Credits expire at the end of your billing period."
    >
      <Text style={paragraph}>Hi {props.name || 'there'},</Text>
      <Text style={paragraph}>
        This is a friendly reminder that you have{' '}
        <strong>{props.credits} unused cleaning credit{props.credits !== 1 ? 's' : ''}</strong> in
        your {props.plan} membership that will expire on <strong>{props.expiryDate}</strong>.
      </Text>

      <Section style={warningBox}>
        <Text style={warningIcon}>⚠️</Text>
        <Text style={warningText}>
          Book your cleaning within the next 3 days to use your credits before they expire!
        </Text>
      </Section>

      <Text style={paragraph}>
        Don't let your credits go to waste! Schedule your cleaning now and enjoy a spotless home.
      </Text>

      <Section style={buttonContainer}>
        <Button href={BRAND.urls.booking}>Book Your Cleaning</Button>
      </Section>

      <Text style={helpText}>
        Need help scheduling? Contact us at{' '}
        <a href={`mailto:${BRAND.contact.email}`} style={link}>
          {BRAND.contact.email}
        </a>
        {' '}or call{' '}
        <a href={`tel:${BRAND.contact.phone}`} style={link}>
          {BRAND.contact.phone}
        </a>
      </Text>

      <Text style={signature}>
        Best regards,
        <br />
        <strong>The Novara Team</strong>
      </Text>
    </EmailLayout>
  );
};

const paragraph = {
  margin: '16px 0',
  fontSize: '16px',
  lineHeight: '1.6',
  color: BRAND.colors.gray[700],
};

const warningBox = {
  textAlign: 'center' as const,
  padding: BRAND.spacing.lg,
  background: '#FEF3C7',
  borderRadius: BRAND.borderRadius.md,
  border: '2px solid #FCD34D',
  margin: `${BRAND.spacing.xl} 0`,
};

const warningIcon = {
  margin: '0',
  fontSize: '48px',
};

const warningText = {
  margin: '12px 0 0 0',
  fontSize: '18px',
  fontWeight: '600',
  color: BRAND.colors.gray[900],
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: `${BRAND.spacing.xl} 0`,
};

const helpText = {
  margin: '24px 0',
  fontSize: '14px',
  lineHeight: '1.6',
  color: BRAND.colors.gray[600],
  textAlign: 'center' as const,
};

const link = {
  color: BRAND.colors.primary,
  textDecoration: 'none',
};

const signature = {
  margin: '24px 0 0 0',
  fontSize: '16px',
  color: BRAND.colors.gray[700],
};

export default CreditExpiryWarning;
