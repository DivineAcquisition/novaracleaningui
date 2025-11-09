import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { Highlight } from './components/Highlight.tsx';
import { BRAND } from './brand.ts';

interface SubscriptionCancelledProps {
  name?: string;
  plan?: string;
}

export const SubscriptionCancelled = (props: SubscriptionCancelledProps) => {
  return (
    <EmailLayout
      title="Subscription Cancelled"
      subtitle="We're sorry to see you go"
      previewText={`Your ${props.plan} membership has been cancelled`}
      footerNote="You can still book one-time cleanings anytime at novaracleaning.com"
    >
      <Text style={paragraph}>Hi {props.name || 'there'},</Text>
      <Text style={paragraph}>
        We're sorry to see you go. Your <strong>{props.plan}</strong> membership has been successfully cancelled.
      </Text>

      <Highlight variant="info">
        <Text style={highlightTitle}>What happens next:</Text>
        <ul style={listStyle}>
          <li>You'll retain access until your current billing period ends</li>
          <li>Any unused credits will expire at the end of the period</li>
          <li>You can still book one-time cleanings anytime</li>
        </ul>
      </Highlight>

      <Text style={paragraph}>
        Changed your mind? You can resubscribe anytime to get back to convenient, regular cleaning!
      </Text>

      <Section style={buttonContainer}>
        <Button href={BRAND.urls.membership}>View Membership Plans</Button>
      </Section>

      <Section style={feedbackBox}>
        <Text style={feedbackText}>
          We'd love to hear your feedback! Your input helps us improve our service for all customers.
        </Text>
        <Text style={feedbackText}>
          <a href={`mailto:${BRAND.contact.email}`} style={link}>
            Share your feedback
          </a>
        </Text>
      </Section>

      <Text style={signature}>
        Thank you for being a valued customer,
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

const highlightTitle = {
  margin: '0 0 12px 0',
  fontSize: '18px',
  fontWeight: '600',
  color: BRAND.colors.gray[900],
};

const listStyle = {
  margin: '8px 0 0 0',
  paddingLeft: '20px',
  color: BRAND.colors.gray[700],
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: `${BRAND.spacing.xl} 0`,
};

const feedbackBox = {
  backgroundColor: BRAND.colors.gray[50],
  padding: BRAND.spacing.lg,
  borderRadius: BRAND.borderRadius.lg,
  margin: `${BRAND.spacing.lg} 0`,
  textAlign: 'center' as const,
};

const feedbackText = {
  margin: '8px 0',
  fontSize: '16px',
  color: BRAND.colors.gray[700],
};

const link = {
  color: BRAND.colors.primary,
  textDecoration: 'none',
  fontWeight: '600',
};

const signature = {
  margin: '24px 0 0 0',
  fontSize: '16px',
  color: BRAND.colors.gray[700],
};

export default SubscriptionCancelled;
