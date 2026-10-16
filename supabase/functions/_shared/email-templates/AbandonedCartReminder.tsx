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
  Row,
  Column,
} from 'https://esm.sh/@react-email/components@0.0.22';
import { BRAND } from './brand.ts';

interface AbandonedCartReminderProps {
  firstName?: string;
  homeSize?: string;
  serviceType?: string;
  resumeUrl: string;
  isSecondReminder?: boolean;
}

export const AbandonedCartReminder = ({
  firstName = 'there',
  homeSize,
  serviceType,
  resumeUrl,
  isSecondReminder = false,
}: AbandonedCartReminderProps) => {
  const previewText = isSecondReminder
    ? "Your Novara booking is still open, with 5% off for 24 hours."
    : "Your Novara booking is still open.";
  const headingText = isSecondReminder ? "Your booking is still open" : "You're almost there";

  return (
    <Html>
      <Head>
        <div dangerouslySetInnerHTML={{ __html: "<!--data-novara-card-->" }} />
      </Head>
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            {BRAND.logo.url && (
              <Img src={BRAND.logo.url} width={BRAND.logo.width} height={BRAND.logo.height} alt={BRAND.name} style={logo} />
            )}
          </Section>

          <Section style={content}>
            <Text style={heading}>{headingText}</Text>
            <Text style={paragraph}>Hi {firstName},</Text>
            <Text style={paragraph}>
              {isSecondReminder
                ? "We noticed you started booking a cleaning but didn't finish. Life gets busy – we get it! Your clean home is just one click away."
                : "Looks like you were in the middle of booking a cleaning with us. Don't let a messy home slow you down!"}
            </Text>

            {(homeSize || serviceType) && (
              <Section style={summaryBox}>
                <Text style={summaryTitle}>Your Booking Details</Text>
                <Row>
                  {homeSize && (
                    <Column style={summaryItem}>
                      <Text style={summaryLabel}>Home Size</Text>
                      <Text style={summaryValue}>{homeSize}</Text>
                    </Column>
                  )}
                  {serviceType && (
                    <Column style={summaryItem}>
                      <Text style={summaryLabel}>Service</Text>
                      <Text style={summaryValue}>{serviceType}</Text>
                    </Column>
                  )}
                </Row>
              </Section>
            )}

            {isSecondReminder && (
              <Section style={urgencyBanner}>
                <Text style={urgencyText}>Complete your booking in the next 24 hours and get <strong>5% off</strong>. New customers only, one per household, and this offer expires 24 hours after this email.</Text>
              </Section>
            )}

            <Section style={ctaSection}>
              <Link href={resumeUrl} style={button}>Complete My Booking</Link>
            </Section>

            <Text style={paragraphSmall}>
              {isSecondReminder
                ? "This is our last reminder – we don't want to bug you! But we'd love to help you enjoy a cleaner home."
                : "Need help? Just reply to this email and we'll assist you with your booking."}
            </Text>
          </Section>

          <Section style={footer}>
            <Text style={footerText}>
              Questions? <Link href={`mailto:${BRAND.contact.email}`} style={link}>{BRAND.contact.email}</Link>
            </Text>
            <Text style={footerText}>© {new Date().getFullYear()} {BRAND.name}. All rights reserved.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const main = { backgroundColor: '#141416', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' };
const container = { backgroundColor: '#2a2a2e', margin: '0 auto', padding: '8px 0 24px', maxWidth: '560px', borderRadius: '16px', border: '1px solid #3a3a40' };
const header = { padding: '20px 28px 0', textAlign: 'left' as const, backgroundColor: '#2a2a2e', borderTop: '3px solid #7c6af7' };
const logo = { margin: '0 0 22px', borderRadius: '12px' };
const content = { padding: '8px 28px 32px' };
const heading = { fontSize: '28px', fontWeight: '700', color: '#ffffff', textAlign: 'left' as const, margin: '0 0 24px' };
const paragraph = { fontSize: '16px', lineHeight: '26px', color: '#d4d4d8', margin: '0 0 16px' };
const paragraphSmall = { fontSize: '14px', lineHeight: '22px', color: BRAND.colors.gray[600], margin: '24px 0 0', textAlign: 'center' as const };
const summaryBox = { backgroundColor: BRAND.colors.gray[50], borderRadius: BRAND.borderRadius.md, padding: '20px 24px', margin: '24px 0', border: `1px solid ${BRAND.colors.gray[200]}` };
const summaryTitle = { fontSize: '14px', fontWeight: '600', color: BRAND.colors.gray[600], margin: '0 0 12px', textTransform: 'uppercase' as const };
const summaryItem = { padding: '0 8px' };
const summaryLabel = { fontSize: '12px', color: BRAND.colors.gray[600], margin: '0 0 4px' };
const summaryValue = { fontSize: '16px', fontWeight: '600', color: BRAND.colors.gray[900], margin: '0' };
const urgencyBanner = { backgroundColor: '#fef3c7', borderRadius: BRAND.borderRadius.md, padding: '16px 20px', margin: '24px 0', border: '1px solid #fcd34d' };
const urgencyText = { fontSize: '15px', color: '#92400e', margin: '0', textAlign: 'center' as const };
const ctaSection = { textAlign: 'center' as const, margin: '32px 0' };
const button = { display: 'inline-block', backgroundColor: '#e7e7ea', color: '#18181b', padding: '14px 28px', borderRadius: '12px', textDecoration: 'none', fontWeight: '600', fontSize: '16px' };
const footer = { padding: '24px 48px', borderTop: `1px solid ${BRAND.colors.gray[200]}` };
const footerText = { fontSize: '13px', lineHeight: '20px', color: BRAND.colors.gray[600], textAlign: 'center' as const, margin: '4px 0' };
const link = { color: BRAND.colors.primary, textDecoration: 'underline' };

export default AbandonedCartReminder;
