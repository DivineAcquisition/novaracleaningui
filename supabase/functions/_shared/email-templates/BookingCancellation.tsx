import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { DetailRow } from './components/DetailRow.tsx';
import { Highlight } from './components/Highlight.tsx';
import { Button } from './components/Button.tsx';
import { BRAND } from './brand.ts';

interface BookingCancellationProps {
  bookingData: {
    first_name: string;
    last_name: string;
    service_type: string;
    service_date: string;
    time_slot: string;
    address: string;
    city: string;
    state: string;
    zip_code: string;
    total_estimate_cents: number;
    cancel_reason?: string;
    refund_amount?: string;
  };
}

export const BookingCancellation = ({ bookingData }: BookingCancellationProps) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const serviceTypeLabels: Record<string, string> = {
    standard: 'Standard Cleaning',
    deep: 'Deep Cleaning',
    moveInOut: 'Move In/Out Cleaning',
  };

  return (
    <EmailLayout title="Booking Cancelled" previewText="Your Novara Cleaning booking has been cancelled">
      <Text style={styles.heading}>Booking Cancelled</Text>

      <Text style={styles.paragraph}>
        Hi {bookingData.first_name || 'there'},
      </Text>

      <Text style={styles.paragraph}>
        Your cleaning booking has been cancelled as requested. Here's a summary of the cancelled booking:
      </Text>

      <Section style={styles.highlightSection}>
        <Highlight>
          <Text style={styles.highlightText}>
            <strong>Cancelled Booking Details</strong>
          </Text>
          <DetailRow
            label="Service"
            value={serviceTypeLabels[bookingData.service_type] || bookingData.service_type}
          />
          <DetailRow label="Date" value={formatDate(bookingData.service_date)} />
          <DetailRow label="Time" value={bookingData.time_slot} />
          <DetailRow
            label="Address"
            value={`${bookingData.address}, ${bookingData.city}, ${bookingData.state} ${bookingData.zip_code}`}
          />
          {bookingData.refund_amount && bookingData.refund_amount !== 'None' && (
            <DetailRow label="Refund Amount" value={bookingData.refund_amount} />
          )}
          {bookingData.cancel_reason && (
            <DetailRow label="Reason" value={bookingData.cancel_reason} />
          )}
        </Highlight>
      </Section>

      {bookingData.refund_amount && bookingData.refund_amount !== 'None' && (
        <Text style={styles.paragraph}>
          A refund of <strong>{bookingData.refund_amount}</strong> has been initiated and should appear
          in your account within 5-10 business days depending on your bank.
        </Text>
      )}

      <Text style={styles.paragraph}>
        We're sorry to see this booking go! If you'd like to rebook at any time, you can do so through
        our booking page.
      </Text>

      <Section style={{ textAlign: 'center' as const, marginTop: '24px' }}>
        <Button href="https://try.novaracleaning.com/book/zip">Book Again</Button>
      </Section>

      <Text style={styles.footer}>
        If you have any questions about your cancellation or refund, please contact us at{' '}
        {BRAND.contact.phone} or {BRAND.contact.email}.
        <br /><br />
        The Novara Cleaning Team
      </Text>
    </EmailLayout>
  );
};

const styles = {
  heading: {
    fontSize: '28px',
    fontWeight: 'bold' as const,
    color: BRAND.colors.primary,
    marginBottom: '24px',
    textAlign: 'center' as const,
  },
  paragraph: {
    fontSize: '16px',
    lineHeight: '24px',
    color: '#374151',
    marginBottom: '16px',
  },
  highlightSection: {
    margin: '32px 0',
  },
  highlightText: {
    fontSize: '18px',
    color: BRAND.colors.primary,
    marginBottom: '16px',
  },
  footer: {
    fontSize: '14px',
    lineHeight: '22px',
    color: '#6B7280',
    marginTop: '32px',
    paddingTop: '24px',
    borderTop: '1px solid #E5E7EB',
  },
};

export default BookingCancellation;
