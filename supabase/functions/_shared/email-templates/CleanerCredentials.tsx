import * as React from 'https://esm.sh/react@18.3.1';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { Highlight } from './components/Highlight.tsx';
import { Text, Section } from 'https://esm.sh/@react-email/components@0.0.22';
import { BRAND } from './brand.ts';

interface CleanerCredentialsProps {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  loginUrl: string;
}

export const CleanerCredentials = ({
  firstName,
  lastName,
  email,
  password,
  loginUrl,
}: CleanerCredentialsProps) => {
  return (
    <EmailLayout
      title={`Welcome to the Team, ${firstName}!`}
      subtitle="Your account has been created"
      previewText="Your Novara Cleaning login credentials"
      footerNote="Keep these credentials secure and change your password after logging in."
    >
      <Text style={paragraph}>
        Hi {firstName},
      </Text>

      <Text style={paragraph}>
        Welcome to Novara Cleaning! Your account has been created and you can now access the contractor portal.
      </Text>

      <Highlight variant="info">
        <Text style={{ ...credentialHeading, margin: '0 0 16px 0' }}>
          Your Login Credentials
        </Text>
        <Section style={credentialBox}>
          <Text style={credentialLabel}>Email:</Text>
          <Text style={credentialValue}>{email}</Text>
          
          <Text style={{ ...credentialLabel, marginTop: '12px' }}>Password:</Text>
          <Text style={credentialValue}>{password}</Text>
          
          <Text style={{ ...credentialLabel, marginTop: '12px' }}>Login URL:</Text>
          <Text style={credentialValueSmall}>contractor.novaracleaning.com/cleaner/auth</Text>
        </Section>
      </Highlight>

      <Section style={{ textAlign: 'center', margin: '32px 0' }}>
        <Button href={loginUrl}>
          Login to Dashboard
        </Button>
      </Section>

      <Text style={paragraph}>
        <strong>Important Security Notes:</strong>
      </Text>
      <Text style={{ ...paragraph, marginTop: '8px' }}>
        • Keep these credentials secure and don't share them with anyone<br />
        • We recommend changing your password after your first login<br />
        • You can update your password in the Profile settings<br />
        • Contact us immediately if you have any issues logging in
      </Text>

      <Text style={paragraph}>
        Once you log in, you'll be able to:
      </Text>
      <Text style={{ ...paragraph, marginTop: '8px' }}>
        ✓ View your assigned bookings and upcoming jobs<br />
        ✓ Track your earnings and payout history<br />
        ✓ Manage your availability and preferences<br />
        ✓ Update your profile and contact information
      </Text>

      <Text style={paragraph}>
        If you have any questions or need assistance, don't hesitate to reach out to our team.
      </Text>

      <Text style={paragraph}>
        Welcome aboard!<br />
        <strong>The Novara Cleaning Team</strong>
      </Text>
    </EmailLayout>
  );
};

const paragraph = {
  fontSize: '16px',
  lineHeight: '24px',
  color: BRAND.colors.gray[700],
  marginBottom: '16px',
};

const credentialHeading = {
  fontSize: '18px',
  fontWeight: '600',
  color: BRAND.colors.gray[900],
};

const credentialBox = {
  backgroundColor: BRAND.colors.gray[50],
  border: `2px solid ${BRAND.colors.primary}`,
  borderRadius: BRAND.borderRadius.md,
  padding: BRAND.spacing.lg,
  marginTop: '16px',
};

const credentialLabel = {
  fontSize: '14px',
  fontWeight: '600',
  color: BRAND.colors.gray[600],
  margin: '0',
};

const credentialValue = {
  fontSize: '18px',
  fontWeight: '700',
  color: BRAND.colors.gray[900],
  margin: '4px 0 0 0',
  fontFamily: 'monospace',
  letterSpacing: '0.5px',
};

const credentialValueSmall = {
  fontSize: '14px',
  fontWeight: '600',
  color: BRAND.colors.primary,
  margin: '4px 0 0 0',
  wordBreak: 'break-all' as const,
};

export default CleanerCredentials;
