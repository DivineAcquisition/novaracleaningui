import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { Highlight } from './components/Highlight.tsx';
import { BRAND } from './brand.ts';

interface MembershipWelcomeProps {
  name?: string;
  plan?: string;
  credits?: number;
}

export const MembershipWelcome = (props: MembershipWelcomeProps) => {
  return (
    <EmailLayout
      title="Welcome to Novara!"
      subtitle={`You're now a ${props.plan} member`}
      previewText={`Welcome to Novara ${props.plan} membership!`}
      footerNote={`You're receiving this because you subscribed to Novara ${props.plan} membership.`}
    >
      <Text style={paragraph}>Hi {props.name || 'there'},</Text>
      <Text style={paragraph}>
        Thank you for becoming a <strong>{props.plan}</strong> member! We're thrilled to have you join the
        Novara family.
      </Text>

      <Section style={creditBadge}>
        <Text style={creditCount}>{props.credits}</Text>
        <Text style={creditLabel}>Cleaning Credit{props.credits !== 1 ? 's' : ''} Added</Text>
      </Section>

      <Highlight variant="info">
        <Text style={highlightTitle}>Your Membership Benefits:</Text>
        <ul style={listStyle}>
          <li>
            <strong>{props.credits} cleaning credit(s)</strong> added to your account
          </li>
          <li>Exclusive discounts on all add-ons</li>
          <li>Priority scheduling and support</li>
          <li>Flexible rescheduling options</li>
        </ul>
      </Highlight>

      <Text style={paragraph}>
        Your credits are ready to use! Book your first cleaning and experience the Novara difference.
      </Text>

      <Section style={buttonContainer}>
        <Button href={BRAND.urls.booking}>Book Your Cleaning</Button>
      </Section>

      <Text style={paragraph}>
        Need help? Our team is here for you at{' '}
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
  fontSize: '48px',
  fontWeight: 'bold',
  color: 'white',
};

const creditLabel = {
  margin: '8px 0 0 0',
  fontSize: '18px',
  color: 'white',
  fontWeight: '600',
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

const link = {
  color: BRAND.colors.primary,
  textDecoration: 'none',
};

const signature = {
  margin: '24px 0 0 0',
  fontSize: '16px',
  color: BRAND.colors.gray[700],
};

export default MembershipWelcome;
