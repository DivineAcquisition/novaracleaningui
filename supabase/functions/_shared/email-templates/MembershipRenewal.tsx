import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { DetailRow } from './components/DetailRow.tsx';
import { BRAND } from './brand.ts';

interface MembershipRenewalProps {
  name?: string;
  plan?: string;
  amount?: number;
  renewalDate?: string;
}

export const MembershipRenewal = (props: MembershipRenewalProps) => {
  const nextRenewalDate = props.renewalDate
    ? new Date(props.renewalDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <EmailLayout
      title="Membership Renewed"
      subtitle="Thank you for staying with us"
      previewText={`Your ${props.plan} membership has been renewed`}
      footerNote="Manage your subscription in your account settings."
    >
      <Text style={paragraph}>Hi {props.name || 'there'},</Text>
      <Text style={paragraph}>
        Your <strong>{props.plan}</strong> membership has been successfully renewed!
      </Text>

      <Section style={detailBox}>
        <Text style={sectionTitle}>🔄 Renewal Summary</Text>
        <DetailRow
          label="Amount charged:"
          value={<strong>${((props.amount || 0) / 100).toFixed(2)}</strong>}
        />
        <DetailRow label="Next renewal:" value={nextRenewalDate} isLast />
      </Section>

      <Section style={successBox}>
        <Text style={successText}>
          ✓ Your credits have been refreshed and are ready to use!
        </Text>
      </Section>

      <Text style={paragraph}>
        Continue enjoying your spotless home with Novara!
      </Text>

      <Section style={buttonContainer}>
        <Button href={BRAND.urls.booking}>Book Your Next Cleaning</Button>
      </Section>

      <Text style={paragraph}>
        Questions? Reach out at{' '}
        <a href={`mailto:${BRAND.contact.email}`} style={link}>
          {BRAND.contact.email}
        </a>
      </Text>

      <Text style={paragraph}>
        <a href={BRAND.urls.account} style={link}>
          Manage your subscription
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

const detailBox = {
  backgroundColor: BRAND.colors.gray[50],
  padding: BRAND.spacing.lg,
  borderRadius: BRAND.borderRadius.lg,
  margin: `${BRAND.spacing.lg} 0`,
};

const sectionTitle = {
  margin: '0 0 16px 0',
  fontSize: '18px',
  fontWeight: '600',
  color: BRAND.colors.primary,
};

const successBox = {
  backgroundColor: '#D1FAE5',
  padding: BRAND.spacing.lg,
  borderRadius: BRAND.borderRadius.lg,
  margin: `${BRAND.spacing.lg} 0`,
  textAlign: 'center' as const,
};

const successText = {
  margin: '0',
  fontSize: '16px',
  fontWeight: '600',
  color: BRAND.colors.success,
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

export default MembershipRenewal;
