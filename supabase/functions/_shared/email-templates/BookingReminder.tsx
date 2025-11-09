import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { DetailRow } from './components/DetailRow.tsx';
import { Highlight } from './components/Highlight.tsx';
import { BRAND } from './brand.ts';

interface BookingReminderProps {
  firstName?: string;
  bookingId?: string;
  serviceDate?: string;
  timeSlot?: string;
  serviceType?: string;
  totalAmount?: number;
  depositAmount?: number;
  paymentOption?: string;
  checkoutUrl?: string;
  reminderType?: '1_hour' | '24_hour';
}

const formatTimeSlot = (slot: string) => {
  const parts = slot.split('-');
  if (parts.length === 2) {
    const startHour = parseInt(parts[0]);
    const endHour = parseInt(parts[1]);
    const formatHour = (h: number) => {
      const period = h >= 12 ? 'PM' : 'AM';
      const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
      return `${hour}:00 ${period}`;
    };
    return `${formatHour(startHour)} - ${formatHour(endHour)}`;
  }
  return slot;
};

const formatServiceType = (type: string) => {
  const types: Record<string, string> = {
    standard: 'Standard Cleaning',
    deep: 'Deep Cleaning',
    moveInOut: 'Move In/Out Cleaning',
  };
  return types[type] || type;
};

export const BookingReminder = (props: BookingReminderProps) => {
  const formattedDate = props.serviceDate
    ? new Date(props.serviceDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  const is24Hour = props.reminderType === '24_hour';
  const title = is24Hour ? '⏰ Your Booking is Waiting!' : '🧹 Complete Your Booking';
  const subtitle = "Don't miss out on your cleaning service!";

  return (
    <EmailLayout
      title={title}
      subtitle={subtitle}
      previewText={`Complete your ${formattedDate} booking`}
      footerNote="You're receiving this because you started a booking at Novara Cleaning."
    >
      <Text style={paragraph}>Hi {props.firstName || 'there'},</Text>

      {is24Hour ? (
        <Highlight variant="danger">
          <Text style={urgentTitle}>⚠️ Your booking will expire soon!</Text>
          <Text style={highlightText}>
            Complete your payment in the next few hours to secure your cleaning appointment.
          </Text>
        </Highlight>
      ) : (
        <Text style={paragraph}>
          We noticed you started booking a cleaning service with Novara but didn't complete your payment. Your
          spot is still available!
        </Text>
      )}

      <Section style={detailBox}>
        <Text style={sectionTitle}>📅 Your Service Details</Text>
        <DetailRow label="Date:" value={<strong>{formattedDate}</strong>} />
        <DetailRow label="Time:" value={<strong>{formatTimeSlot(props.timeSlot || '')}</strong>} />
        <DetailRow label="Service:" value={formatServiceType(props.serviceType || '')} />
        <DetailRow
          label="Amount:"
          value={
            <>
              <strong>
                ${(((props.paymentOption === 'deposit' ? (props.depositAmount || 0) : (props.totalAmount || 0))) / 100).toFixed(2)}
              </strong>
              {props.paymentOption === 'deposit' ? ' deposit' : ' (full payment - save 10%!)'}
            </>
          }
          isLast
        />
      </Section>

      {!is24Hour && (
        <Highlight variant="info">
          <Text style={highlightTitle}>💡 Why Choose Novara?</Text>
          <ul style={listStyle}>
            <li>Professional, vetted cleaning teams</li>
            <li>Flexible scheduling and easy rescheduling</li>
            <li>Satisfaction guarantee on every service</li>
            <li>Secure payment processing</li>
          </ul>
        </Highlight>
      )}

      <Section style={buttonContainer}>
        <Button href={props.checkoutUrl || BRAND.urls.booking}>
          {is24Hour ? '🚀 Complete Payment Now' : '✨ Complete Your Booking'}
        </Button>
      </Section>

      <Text style={referenceText}>
        Booking Reference: <strong>{props.bookingId}</strong>
      </Text>

      {is24Hour ? (
        <Text style={helpText}>
          Need help or have questions? Reply to this email or call us at {BRAND.contact.phone}
        </Text>
      ) : (
        <Text style={paragraph}>
          Have questions or need to adjust your booking? Just reply to this email and we'll help you out!
        </Text>
      )}

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

const urgentTitle = {
  margin: '0',
  fontSize: '16px',
  fontWeight: '600',
  color: BRAND.colors.danger,
};

const highlightTitle = {
  margin: '0',
  fontSize: '16px',
  fontWeight: '600',
  color: BRAND.colors.gray[900],
};

const highlightText = {
  margin: '8px 0 0 0',
  fontSize: '14px',
  color: BRAND.colors.gray[700],
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

const referenceText = {
  textAlign: 'center' as const,
  fontSize: '14px',
  color: BRAND.colors.gray[600],
  margin: '20px 0',
};

const helpText = {
  textAlign: 'center' as const,
  color: BRAND.colors.gray[600],
  fontSize: '14px',
  margin: '20px 0',
};

const signature = {
  margin: '24px 0 0 0',
  fontSize: '16px',
  color: BRAND.colors.gray[700],
};

export default BookingReminder;
