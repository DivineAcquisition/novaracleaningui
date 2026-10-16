import * as React from 'https://esm.sh/react@18.3.1';
import { Section, Text } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { BRAND } from './brand.ts';

interface WaitlistConfirmationProps {
  firstName?: string;
  zipCode: string;
  city?: string;
}

export const WaitlistConfirmation = ({
  firstName = 'there',
  zipCode,
  city,
}: WaitlistConfirmationProps) => {
  const locationText = city ? `${city} (${zipCode})` : zipCode;

  return (
    <EmailLayout
      title="You're on the list"
      previewText="You're on the Novara Cleaning waitlist. We're expanding soon."
    >
      <Text style={paragraph}>Hi {firstName},</Text>
      <Text style={paragraph}>
        Thanks for your interest in Novara Cleaning. While we don't currently
        service <strong>{locationText}</strong>, we're actively expanding and
        your area is on our radar.
      </Text>
      <Text style={paragraph}>We've added you to our priority waitlist, which means:</Text>
      <Section style={listBox}>
        <Text style={listItem}>You'll be the first to know when we launch in your area</Text>
        <Text style={listItem}>Early access when booking opens for waitlist members</Text>
        <Text style={listItem}>Founding member details when your area opens</Text>
      </Section>
      <Text style={paragraph}>
        We're working to bring cleaning to more communities. We'll email you when your area opens.
      </Text>
      <Section style={cta}>
        <Button href={`mailto:${BRAND.contact.email}`}>Email us</Button>
      </Section>
    </EmailLayout>
  );
};

const paragraph = { fontSize: '16px', lineHeight: '26px', color: '#d4d4d8', margin: '0 0 16px' };
const listBox = { backgroundColor: '#1c1c20', border: '1px solid #3a3a40', borderRadius: '12px', padding: '8px 18px', margin: '8px 0 16px' };
const listItem = { fontSize: '15px', lineHeight: '24px', color: '#d4d4d8', margin: '8px 0' };
const cta = { margin: '22px 0 0' };

export default WaitlistConfirmation;
