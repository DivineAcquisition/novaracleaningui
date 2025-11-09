import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { DetailRow } from './components/DetailRow.tsx';
import { Highlight } from './components/Highlight.tsx';
import { BRAND } from './brand.ts';

interface PaymentReceiptProps {
  firstName?: string;
  bookingId?: string;
  serviceDate?: string;
  timeSlot?: string;
  serviceType?: string;
  totalAmount?: number;
  paymentOption?: string;
  balanceAmount?: number;
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

export const PaymentReceipt = (props: PaymentReceiptProps) => {
  const formattedDate = props.serviceDate
    ? new Date(props.serviceDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <EmailLayout
      title="💳 Payment Receipt"
      subtitle="Thank you for your payment"
      previewText="Payment received for your Novara cleaning service"
      footerNote="This is an automated receipt for your records."
    >
      <Text style={paragraph}>Hi {props.firstName || 'there'},</Text>
      <Text style={paragraph}>
        We've received your payment for your upcoming Novara cleaning service.
      </Text>

      <Section style={detailBox}>
        <Text style={sectionTitle}>💰 Payment Details</Text>
        <DetailRow label="Amount Paid:" value={<strong>${((props.totalAmount || 0) / 100).toFixed(2)}</strong>} />
        <DetailRow
          label="Payment Type:"
          value={props.paymentOption === 'full' ? 'Paid in Full' : 'Deposit'}
        />
        <DetailRow
          label="Date:"
          value={new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        />
        <DetailRow label="Reference:" value={props.bookingId || ''} isLast />
      </Section>

      <Section style={detailBox}>
        <Text style={sectionTitle}>🏠 Service Details</Text>
        <DetailRow label="Service Date:" value={formattedDate} />
        <DetailRow label="Time:" value={formatTimeSlot(props.timeSlot || '')} />
        <DetailRow label="Service Type:" value={formatServiceType(props.serviceType || '')} isLast />
      </Section>

      {props.paymentOption === 'deposit' && props.balanceAmount && (
        <Highlight variant="warning">
          <Text style={highlightTitle}>
            <strong>Remaining Balance:</strong> ${((props.balanceAmount || 0) / 100).toFixed(2)}
          </Text>
          <Text style={highlightText}>This will be charged after your cleaning is complete.</Text>
        </Highlight>
      )}

      <Section style={buttonContainer}>
        <Button href={BRAND.urls.account}>View Full Receipt</Button>
      </Section>

      <Text style={paragraph}>
        Need a copy of this receipt? It's always available in your account dashboard.
      </Text>

      <Text style={paragraph}>
        Questions? Contact us at{' '}
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

const highlightTitle = {
  margin: '0',
  fontSize: '16px',
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

const link = {
  color: BRAND.colors.primary,
  textDecoration: 'none',
};

const signature = {
  margin: '24px 0 0 0',
  fontSize: '16px',
  color: BRAND.colors.gray[700],
};

export default PaymentReceipt;
