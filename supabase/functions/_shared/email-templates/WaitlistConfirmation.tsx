import * as React from 'https://esm.sh/react@18.3.1';
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Preview,
  Img,
} from 'https://esm.sh/@react-email/components@0.0.22';
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
    <Html>
      <Head />
      <Preview>You're on the Novara Cleaning waitlist! We're expanding soon.</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            {BRAND.logo.url && (
              <Img src={BRAND.logo.url} width={BRAND.logo.width} height={BRAND.logo.height} alt={BRAND.name} style={logo} />
            )}
          </Section>

          <Section style={content}>
            <Text style={heading}>You're on the List! 🎉</Text>
            <Text style={paragraph}>Hi {firstName},</Text>
            <Text style={paragraph}>
              Thanks for your interest in Novara Cleaning! While we don't currently 
              service <strong>{locationText}</strong>, we're actively expanding and 
              your area is on our radar.
            </Text>
            <Text style={paragraph}>We've added you to our priority waitlist, which means:</Text>
            <Section style={benefitsList}>
              <Text style={benefitItem}>✓ You'll be the first to know when we launch in your area</Text>
              <Text style={benefitItem}>✓ Exclusive early access pricing for waitlist members</Text>
              <Text style={benefitItem}>✓ Special founding member perks</Text>
            </Section>
            <Text style={paragraph}>
              We're working hard to bring our premium cleaning services to more 
              communities in the coming months. Keep an eye on your inbox!
            </Text>
            <Section style={ctaSection}>
              <Link href={`mailto:${BRAND.contact.email}`} style={button}>Learn More About Us</Link>
            </Section>
          </Section>

          <Section style={footer}>
            <Text style={footerText}>
              Questions? Reply to this email or reach us at{' '}
              <Link href={`mailto:${BRAND.contact.email}`} style={link}>{BRAND.contact.email}</Link>
            </Text>
            <Text style={footerText}>© {new Date().getFullYear()} {BRAND.name}. All rights reserved.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const main = { backgroundColor: '#f6f9fc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' };
const container = { backgroundColor: '#ffffff', margin: '0 auto', padding: '20px 0 48px', maxWidth: '600px' };
const header = { padding: '32px 48px 24px', textAlign: 'center' as const, background: BRAND.gradient.primary };
const logo = { margin: '0 auto' };
const content = { padding: '32px 48px' };
const heading = { fontSize: '28px', fontWeight: '700', color: BRAND.colors.gray[900], textAlign: 'center' as const, margin: '0 0 24px' };
const paragraph = { fontSize: '16px', lineHeight: '26px', color: BRAND.colors.gray[700], margin: '0 0 16px' };
const benefitsList = { backgroundColor: BRAND.colors.gray[50], borderRadius: BRAND.borderRadius.md, padding: '20px 24px', margin: '24px 0' };
const benefitItem = { fontSize: '15px', lineHeight: '24px', color: BRAND.colors.gray[900], margin: '8px 0' };
const ctaSection = { textAlign: 'center' as const, margin: '32px 0' };
const button = { display: 'inline-block', background: BRAND.gradient.primary, color: '#ffffff', padding: '14px 32px', borderRadius: BRAND.borderRadius.md, textDecoration: 'none', fontWeight: '600', fontSize: '16px' };
const footer = { padding: '24px 48px', borderTop: `1px solid ${BRAND.colors.gray[200]}` };
const footerText = { fontSize: '13px', lineHeight: '20px', color: BRAND.colors.gray[600], textAlign: 'center' as const, margin: '4px 0' };
const link = { color: BRAND.colors.primary, textDecoration: 'underline' };

export default WaitlistConfirmation;
