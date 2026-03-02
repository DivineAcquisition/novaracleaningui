import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { DetailRow } from './components/DetailRow.tsx';
import { Highlight } from './components/Highlight.tsx';
import { Button } from './components/Button.tsx';
import { BRAND } from './brand.ts';

interface BookingThankYouProps {
  firstName?: string;
  bookingId?: string;
  serviceDate?: string;
  timeSlot?: string;
  serviceType?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  totalAmount?: number;
}

export const BookingThankYou = ({
  firstName = 'there',
  bookingId,
  serviceDate,
  timeSlot,
  serviceType,
  address,
  city,
  state,
  zipCode,
  totalAmount,
}: BookingThankYouProps) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  };

  const serviceTypeLabels: Record<string, string> = {
    standard: 'Standard Cleaning',
    deep: 'Deep Cleaning',
    moveInOut: 'Move In/Out Cleaning',
  };

  return (
    <EmailLayout title="Thank You!" previewText="Thank you for choosing Novara Cleaning!">
      <Text style={styles.heading}>Thank You, {firstName}!</Text>

      <Text style={styles.paragraph}>
        Your cleaning has been completed! We hope your home feels fresh and sparkling.
        Thank you for choosing Novara Cleaning.
      </Text>

      <Section style={styles.highlightSection}>
        <Highlight>
          <Text style={styles.highlightText}>
            <strong>Completed Cleaning</strong>
          </Text>
          {serviceDate && <DetailRow label="Date" value={formatDate(serviceDate)} />}
          {timeSlot && <DetailRow label="Time" value={timeSlot} />}
          {serviceType && (
            <DetailRow label="Service" value={serviceTypeLabels[serviceType] || serviceType} />
          )}
          {address && (
            <DetailRow label="Address" value={`${address}, ${city}, ${state} ${zipCode}`} />
          )}
          {totalAmount != null && totalAmount > 0 && (
            <DetailRow label="Total" value={`$${(totalAmount / 100).toFixed(2)}`} />
          )}
        </Highlight>
      </Section>

      <Text style={styles.paragraph}>
        <strong>How did we do?</strong> We'd love your feedback! Log into your account
        to rate your cleaner and leave a review.
      </Text>

      <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
        <Button href="https://app.novaracleaning.com/account">Rate Your Cleaning</Button>
      </Section>

      <Text style={styles.paragraph}>
        <strong>Refer a friend and earn $50!</strong> Share your referral code from your
        account dashboard and both you and your friend will save.
      </Text>

      <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
        <Button href="https://try.novaracleaning.com/book/zip">Book Your Next Cleaning</Button>
      </Section>

      <Text style={styles.footer}>
        Questions? Contact us at {BRAND.contact.phone} or {BRAND.contact.email}.
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

export default BookingThankYou;
