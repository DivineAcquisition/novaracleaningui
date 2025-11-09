import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { BRAND } from './brand.ts';

interface CreditAllocatedProps {
  name?: string;
  plan?: string;
  credits?: number;
  renewalDate?: string;
}

export const CreditAllocated = (props: CreditAllocatedProps) => {
  const validUntil = props.renewalDate
    ? new Date(props.renewalDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <EmailLayout
      title="Credits Added!"
      subtitle="Time to book your next cleaning"
      previewText={`${props.credits} new cleaning credit(s) added!`}
      footerNote="Your credits never expire within your billing period."
    >
      <Text style={paragraph}>Hi {props.name || 'there'},</Text>
      <Text style={paragraph}>
        Great news! <strong>{props.credits} new cleaning credit(s)</strong> have been added to your{' '}
        {props.plan} membership account.
      </Text>

      <Section style={creditBadge}>
        <Text style={creditCount}>{props.credits}</Text>
        <Text style={creditLabel}>Credit{props.credits !== 1 ? 's' : ''}</Text>
        <Text style={validText}>Valid until {validUntil}</Text>
      </Section>

      <Text style={paragraph}>
        Book your cleaning today and enjoy the convenience of a professionally cleaned home!
      </Text>

      <Section style={buttonContainer}>
        <Button href={BRAND.urls.booking}>Use Your Credits</Button>
      </Section>

      <Text style={paragraph}>
        Need assistance? Contact us at{' '}
        <a href={`mailto:${BRAND.contact.email}`} style={link}>
          {BRAND.contact.email}
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

const creditBadge = {
  textAlign: 'center' as const,
  padding: BRAND.spacing.xl,
  background: BRAND.gradient.primary,
  borderRadius: BRAND.borderRadius.lg,
  margin: `${BRAND.spacing.xl} 0`,
};

const creditCount = {
  margin: '0',
  fontSize: '64px',
  fontWeight: 'bold',
  color: 'white',
};

const creditLabel = {
  margin: '8px 0',
  fontSize: '24px',
  color: 'white',
  fontWeight: '600',
};

const validText = {
  margin: '12px 0 0 0',
  fontSize: '14px',
  color: 'white',
  opacity: 0.9,
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: `${BRAND.spacing.xl} 0`,
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

export default CreditAllocated;
