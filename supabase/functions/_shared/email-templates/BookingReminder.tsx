import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { DetailRow } from './components/DetailRow.tsx';
import { Highlight } from './components/Highlight.tsx';
import { BRAND } from './brand.ts';

type ReminderType = '10_minute' | '2_hour' | 'next_day_noon' | 'day_2' | '24_hour';

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
  reminderType?: ReminderType;
  emailHeadline?: string;
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
    focused: 'Focused Clean',
  };
  return types[type] || type;
};

function copyForType(type: ReminderType | undefined, firstName?: string) {
  const name = firstName || 'there';
  switch (type) {
    case '2_hour':
      return {
        title: 'Your cleaning spot is still held',
        subtitle: 'Continue where you left off — it only takes a minute.',
        highlightVariant: 'info' as const,
        highlightTitle: 'Still thinking it over?',
        highlightBody:
          `Hi ${name}, your Novara booking is saved. Tap below to pick up right where you stopped — no need to re-enter your details.`,
        cta: 'Continue my booking',
        urgent: false,
      };
    case 'next_day_noon':
      return {
        title: 'Good afternoon — your booking is still open',
        subtitle: "Yesterday's cleaning request is waiting for you.",
        highlightVariant: 'info' as const,
        highlightTitle: 'Pick up where you left off',
        highlightBody:
          `Hi ${name}, we saved your session from yesterday. Continue with the same service and time — one secure link, no starting over.`,
        cta: 'Resume my booking',
        urgent: false,
      };
    case 'day_2':
    case '24_hour':
      return {
        title: 'Final reminder — complete your booking',
        subtitle: 'Your unfinished booking expires soon.',
        highlightVariant: 'danger' as const,
        highlightTitle: 'Last chance to keep your date',
        highlightBody:
          `Hi ${name}, this is your final reminder. Complete payment with the link below to lock in your cleaning before the hold is released.`,
        cta: 'Complete payment now',
        urgent: true,
      };
    case '10_minute':
    default:
      return {
        title: "You're almost done — finish & save $30",
        subtitle: 'One step left to lock in your Novara cleaning.',
        highlightVariant: 'info' as const,
        highlightTitle: 'Save $30 as a new customer',
        highlightBody:
          `Hi ${name}, you're just one step away. Continue your saved booking below to finish checkout and claim the new-customer discount.`,
        cta: 'Finish & save $30',
        urgent: false,
      };
  }
}

export const BookingReminder = (props: BookingReminderProps) => {
  const formattedDate = props.serviceDate
    ? new Date(props.serviceDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  const copy = copyForType(props.reminderType, props.firstName);
  const title = props.emailHeadline || copy.title;

  return (
    <EmailLayout
      title={title}
      subtitle={copy.subtitle}
      previewText={`${title}${formattedDate ? ` · ${formattedDate}` : ''}`}
      footerNote="You're receiving this because you started a booking at Novara Cleaning. This link restores your saved session."
    >
      <Text style={paragraph}>Hi {props.firstName || 'there'},</Text>

      <Highlight variant={copy.highlightVariant}>
        <Text style={copy.urgent ? urgentTitle : highlightTitle}>{copy.highlightTitle}</Text>
        <Text style={highlightText}>{copy.highlightBody}</Text>
      </Highlight>

      <Section style={detailBox}>
        <Text style={sectionTitle}>Your saved booking</Text>
        {formattedDate ? <DetailRow label="Date:" value={<strong>{formattedDate}</strong>} /> : null}
        {props.timeSlot ? (
          <DetailRow label="Time:" value={<strong>{formatTimeSlot(props.timeSlot)}</strong>} />
        ) : null}
        <DetailRow label="Service:" value={formatServiceType(props.serviceType || '')} />
        <DetailRow
          label="Amount:"
          value={
            <>
              <strong>
                $
                {(
                  ((props.paymentOption === 'deposit'
                    ? props.depositAmount || 0
                    : props.totalAmount || 0) /
                    100)
                ).toFixed(2)}
              </strong>
              {props.paymentOption === 'deposit' ? ' deposit' : ' (paid in full)'}
            </>
          }
          isLast
        />
      </Section>

      <Section style={buttonContainer}>
        <Button href={props.checkoutUrl || BRAND.urls.booking}>{copy.cta}</Button>
      </Section>

      <Text style={referenceText}>
        Secure resume link — your details stay filled in when you continue.
        {props.bookingId ? (
          <>
            <br />
            Booking reference: <strong>{props.bookingId}</strong>
          </>
        ) : null}
      </Text>

      <Text style={helpText}>
        Need help? Reply to this email or call us at {BRAND.contact.phone}
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
  margin: '16px 0',
  fontSize: '14px',
  lineHeight: '1.6',
  color: BRAND.colors.gray[600],
  textAlign: 'center' as const,
};

const signature = {
  margin: '24px 0 0 0',
  fontSize: '16px',
  lineHeight: '1.6',
  color: BRAND.colors.gray[700],
};

export default BookingReminder;
