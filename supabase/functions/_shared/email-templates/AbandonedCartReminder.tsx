import * as React from 'https://esm.sh/react@18.3.1';
import { Section, Text, Row, Column } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';

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
    <EmailLayout title={headingText} previewText={previewText}>
      <Text style={paragraph}>Hi {firstName},</Text>
      <Text style={paragraph}>
        {isSecondReminder
          ? "We noticed you started booking a cleaning but didn't finish. Your clean is one step away."
          : "Looks like you were in the middle of booking a cleaning with us."}
      </Text>

      {(homeSize || serviceType) && (
        <Section style={summaryBox}>
          <Text style={summaryTitle}>Your booking details</Text>
          <Row>
            {homeSize && (
              <Column style={summaryItem}>
                <Text style={summaryLabel}>Home size</Text>
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
        <Text style={paragraph}>
          Complete your booking in the next 24 hours and get 5% off. New customers only, one per household, and this offer expires 24 hours after this email.
        </Text>
      )}

      <Section style={cta}>
        <Button href={resumeUrl}>Complete my booking</Button>
      </Section>

      <Text style={paragraph}>
        {isSecondReminder
          ? "This is the last reminder about this booking."
          : "Need help? Reply to this email and we'll assist you with your booking."}
      </Text>
    </EmailLayout>
  );
};

const paragraph = { fontSize: '16px', lineHeight: '26px', color: '#d4d4d8', margin: '0 0 16px' };
const summaryBox = { backgroundColor: '#1c1c20', border: '1px solid #3a3a40', borderRadius: '12px', padding: '16px 18px', margin: '8px 0 16px' };
const summaryTitle = { fontSize: '14px', fontWeight: '600', color: '#ffffff', margin: '0 0 12px' };
const summaryItem = { padding: '0 8px' };
const summaryLabel = { fontSize: '12px', color: '#a1a1aa', margin: '0 0 4px' };
const summaryValue = { fontSize: '16px', fontWeight: '600', color: '#ffffff', margin: '0' };
const cta = { margin: '8px 0 16px' };

export default AbandonedCartReminder;
