import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section, Hr } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { DetailRow } from './components/DetailRow.tsx';
import { BRAND } from './brand.ts';

interface RescheduleConfirmationProps {
  firstName?: string;
  bookingId?: string;
  oldDate?: string;
  oldTimeSlot?: string;
  newDate?: string;
  newTimeSlot?: string;
  serviceType?: string;
  address?: string;
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

export const RescheduleConfirmation = (props: RescheduleConfirmationProps) => {
  const oldFormattedDate = props.oldDate
    ? new Date(props.oldDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  const newFormattedDate = props.newDate
    ? new Date(props.newDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <EmailLayout
      title="✅ Booking Rescheduled"
      subtitle="Your appointment has been updated"
      previewText={`Your cleaning has been rescheduled to ${newFormattedDate}`}
      footerNote={`Booking Reference: ${props.bookingId}`}
    >
      <Text style={paragraph}>Hi {props.firstName || 'there'},</Text>
      <Text style={paragraph}>
        Your cleaning appointment has been successfully rescheduled. Here are your updated details:
      </Text>

      <Section style={comparisonContainer}>
        <Section style={oldDetailsBox}>
          <Text style={boxLabel}>Previous Appointment</Text>
          <Text style={strikethroughText}>{oldFormattedDate}</Text>
          <Text style={strikethroughText}>{formatTimeSlot(props.oldTimeSlot || '')}</Text>
        </Section>

        <Text style={arrowText}>→</Text>

        <Section style={newDetailsBox}>
          <Text style={boxLabelNew}>New Appointment</Text>
          <Text style={newDateText}>{newFormattedDate}</Text>
          <Text style={newDateText}>{formatTimeSlot(props.newTimeSlot || '')}</Text>
        </Section>
      </Section>

      <Section style={detailBox}>
        <Text style={sectionTitle}>🏠 Service Details</Text>
        <DetailRow label="Service:" value={formatServiceType(props.serviceType || '')} />
        <DetailRow label="Location:" value={props.address || ''} isLast />
      </Section>

      <Section style={successBox}>
        <Text style={successText}>
          ✓ Your new appointment is confirmed! We'll send you a reminder 24 hours before your cleaning.
        </Text>
      </Section>

      <Section style={buttonContainer}>
        <Button href={BRAND.urls.account}>View Booking Details</Button>
      </Section>

      <Text style={paragraph}>
        Need to make another change? Contact us at{' '}
        <a href={`mailto:${BRAND.contact.email}`} style={link}>
          {BRAND.contact.email}
        </a>{' '}
        or call {BRAND.contact.phone}
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

const comparisonContainer = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  margin: `${BRAND.spacing.xl} 0`,
  gap: '20px',
};

const oldDetailsBox = {
  flex: 1,
  padding: BRAND.spacing.lg,
  backgroundColor: BRAND.colors.gray[100],
  borderRadius: BRAND.borderRadius.lg,
  textAlign: 'center' as const,
};

const newDetailsBox = {
  flex: 1,
  padding: BRAND.spacing.lg,
  background: 'linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%)',
  borderRadius: BRAND.borderRadius.lg,
  textAlign: 'center' as const,
};

const boxLabel = {
  margin: '0 0 12px 0',
  fontSize: '14px',
  fontWeight: '600',
  color: BRAND.colors.gray[600],
  textTransform: 'uppercase' as const,
};

const boxLabelNew = {
  margin: '0 0 12px 0',
  fontSize: '14px',
  fontWeight: '600',
  color: BRAND.colors.success,
  textTransform: 'uppercase' as const,
};

const strikethroughText = {
  margin: '4px 0',
  fontSize: '16px',
  color: BRAND.colors.gray[600],
  textDecoration: 'line-through',
};

const newDateText = {
  margin: '4px 0',
  fontSize: '16px',
  fontWeight: '600',
  color: BRAND.colors.gray[900],
};

const arrowText = {
  fontSize: '32px',
  color: BRAND.colors.success,
  fontWeight: 'bold',
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
};

const successText = {
  margin: '0',
  fontSize: '16px',
  color: BRAND.colors.gray[900],
  textAlign: 'center' as const,
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

export default RescheduleConfirmation;
