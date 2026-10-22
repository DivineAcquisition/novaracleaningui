import * as React from 'https://esm.sh/react@18.3.1';
import { Text, Section, Hr } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { DetailRow } from './components/DetailRow.tsx';
import { Highlight } from './components/Highlight.tsx';
import { BRAND } from './brand.ts';
import { HOME_SIZE_RANGES } from '../pricing.ts';

interface BookingConfirmationProps {
  firstName?: string;
  lastName?: string;
  bookingId?: string;
  bookingNumber?: string;
  serviceDate?: string;
  timeSlot?: string;
  arrivalWindow?: string;
  serviceType?: string;
  homeSize?: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: string;
  frequency?: string;
  membershipPlan?: string;
  paymentMethod?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  totalAmount?: number;
  depositAmount?: number;
  balanceAmount?: number;
  paymentOption?: string;
  useCredit?: boolean;
  addOns?: string[];
  newCustomerDiscount?: number;
  membershipDiscount?: number;
  fullPaymentDiscount?: number;
  /**
   * Unused. The checklist is its own email, with a private link for this booking.
   * Callers may still pass this.
   */
  checklistLink?: string;
  /**
   * Hosted invoice URL — when an invoice is attached to the booking
   * (VA-flow deposit_plus_remaining or full_now), the email surfaces
   * a "Pay invoice" CTA. Customers paying via the deposit funnel get
   * an empty value here and the CTA is hidden.
   */
  hostedInvoiceUrl?: string;
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
    combo: 'Deep + Standard Combo',
    focused: 'Focused / Single-Area Clean',
  };
  return types[type] || type;
};

const formatFrequency = (value?: string) => {
  const labels: Record<string, string> = {
    once: "One-time",
    "one-time": "One-time",
    "One-Time": "One-time",
    onetime: "One-time",
    weekly: "Weekly",
    biweekly: "Every 2 weeks",
    "bi-weekly": "Every 2 weeks",
    monthly: "Monthly",
  };
  if (!value) return "";
  return labels[value] || value;
};

const shownCount = (value?: number | string) => {
  if (value === undefined || value === null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(n);
};

const homeSizeLabel = (value?: string) => {
  if (!value) return "";
  const known = HOME_SIZE_RANGES.find((range) => range.id === value)?.label;
  if (known) return known;
  // Stored ids such as 0_999 are not a size a customer can read.
  if (value.includes("_")) return "";
  return value;
};

const homeLine = (props: BookingConfirmationProps) => {
  const beds = shownCount(props.bedrooms);
  const baths = shownCount(props.bathrooms);
  const parts = [
    beds ? `${beds} bed` : "",
    baths ? `${baths} bath` : "",
    props.sqft ? `${props.sqft} sq ft` : "",
    homeSizeLabel(props.homeSize),
  ].filter(Boolean);
  return parts.join(" · ");
};

const formatAddOns = (addOns: string[]) => {
  const addOnLabels: Record<string, string> = {
    fridge: 'Refrigerator Cleaning',
    oven: 'Oven Cleaning',
    windows: 'Interior Windows',
  };
  return addOns.map(addon => addOnLabels[addon] || addon).join(', ');
};

export const BookingConfirmation = (props: BookingConfirmationProps) => {
  // serviceDate is a calendar day ("2026-08-05"). Parsed bare it becomes UTC
  // midnight, which renders as the previous day everywhere we operate — so the
  // confirmation email would name the wrong date. Anchor it at local noon.
  const formattedDate = props.serviceDate
    ? new Date(
        /^\d{4}-\d{2}-\d{2}$/.test(props.serviceDate)
          ? `${props.serviceDate}T12:00:00`
          : props.serviceDate,
      ).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <EmailLayout
      title="🎉 Booking Confirmed!"
      subtitle="Thank you for choosing Novara Cleaning"
      previewText={`Your cleaning on ${formattedDate} is confirmed!`}
      footerNote={`Booking ${props.bookingNumber || props.bookingId || ""}`}
    >
      <Text style={paragraph}>Hi {props.firstName || 'there'},</Text>
      <Text style={paragraph}>
        Your cleaning is booked. The details below are the ones on your booking.
      </Text>

      <Section style={detailBox}>
        <Text style={sectionTitle}>Booking details</Text>
        {props.bookingNumber ? <DetailRow label="Booking:" value={<strong>{props.bookingNumber}</strong>} /> : null}
        <DetailRow label="Date:" value={<strong>{formattedDate}</strong>} />
        <DetailRow label="Arrival window:" value={<strong>{props.arrivalWindow || formatTimeSlot(props.timeSlot || '')}</strong>} />
        {props.timeSlot && props.arrivalWindow && props.arrivalWindow !== props.timeSlot ? (
          <DetailRow label="Time slot:" value={formatTimeSlot(props.timeSlot)} />
        ) : null}
        <DetailRow label="Service:" value={formatServiceType(props.serviceType || '')} />
        {formatFrequency(props.frequency) ? <DetailRow label="Frequency:" value={formatFrequency(props.frequency)} /> : null}
        {props.membershipPlan ? <DetailRow label="Plan:" value={props.membershipPlan} /> : null}
        {homeLine(props) ? <DetailRow label="Home:" value={homeLine(props)} /> : null}
        {props.addOns && props.addOns.length > 0 ? (
          <DetailRow label="Add-ons:" value={formatAddOns(props.addOns)} />
        ) : null}
        <DetailRow
          label="Address:"
          value={[props.address, [props.city, props.state, props.zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
          isLast
        />
      </Section>

      {/* Savings Section - Show all discounts */}
      {(props.newCustomerDiscount || props.membershipDiscount || props.fullPaymentDiscount) && (
        <Section style={savingsBox}>
          <Text style={savingsTitle}>💰 Your Savings</Text>
          {props.newCustomerDiscount && (
            <DetailRow 
              label="New Customer Discount:" 
              value={<span style={savingsAmount}>-${(props.newCustomerDiscount / 100).toFixed(2)}</span>} 
            />
          )}
          {props.membershipDiscount && (
            <DetailRow 
              label="Membership Savings:" 
              value={<span style={savingsAmount}>-${(props.membershipDiscount / 100).toFixed(2)}</span>} 
            />
          )}
          {props.fullPaymentDiscount && (
            <DetailRow 
              label="Pay in Full Discount:" 
              value={<span style={savingsAmount}>-${(props.fullPaymentDiscount / 100).toFixed(2)}</span>} 
            />
          )}
          <Hr style={{ margin: '12px 0' }} />
          <DetailRow 
            label="Total Savings:" 
            value={
              <span style={totalSavingsAmount}>
                -${(((props.newCustomerDiscount || 0) + (props.membershipDiscount || 0) + (props.fullPaymentDiscount || 0)) / 100).toFixed(2)}
              </span>
            }
            isLast
          />
        </Section>
      )}

      {props.useCredit ? (
        <Highlight variant="success">
          <Text style={highlightTitle}>✨ Membership Credit Used</Text>
          <Text style={highlightText}>This cleaning is covered by your membership credit!</Text>
        </Highlight>
      ) : props.paymentOption === 'deposit' ? (
        <Section style={detailBox}>
          <Text style={sectionTitle}>Payment</Text>
          {props.totalAmount ? <DetailRow label="Booking total:" value={`$${((props.totalAmount || 0) / 100).toFixed(2)}`} /> : null}
          <DetailRow label="Deposit paid:" value={<strong>${((props.depositAmount || 0) / 100).toFixed(2)}</strong>} />
          <DetailRow
            label="Balance due:"
            value={`$${((props.balanceAmount || 0) / 100).toFixed(2)} after the cleaning`}
          />
          {props.paymentMethod ? <DetailRow label="Payment method:" value={props.paymentMethod} isLast /> : <DetailRow label="Payment method:" value="Card on file" isLast />}
        </Section>
      ) : (
        <Section style={detailBox}>
          <Text style={sectionTitle}>💳 Payment Summary</Text>
          <DetailRow
            label="Amount Paid:"
            value={
              <>
                <strong>${((props.totalAmount || 0) / 100).toFixed(2)}</strong>{' '}
                <span style={successBadge}>PAID IN FULL</span>
              </>
            }
            isLast
          />
        </Section>
      )}

      <Highlight variant="warning">
        <Text style={highlightTitle}>📋 What to Expect:</Text>
        <ul style={listStyle}>
          <li>You'll receive a reminder 24 hours before your cleaning</li>
          <li>Our team will arrive during your selected time window</li>
          <li>Please ensure access to your home (key, code, etc.)</li>
          <li>Secure any valuables or fragile items</li>
        </ul>
      </Highlight>

      {/* The cleaning checklist is its own email, with a private link.
          It is not repeated here. */}

      {/* Hosted invoice CTA — only shown when an invoice is attached
          to the booking (VA-channel deposit_plus_remaining / full_now
          flows). Customers paying via the in-funnel deposit don't see
          this since their card was already charged. */}
      {props.hostedInvoiceUrl && (
        <Section style={buttonContainer}>
          <Button href={props.hostedInvoiceUrl}>Pay Your Invoice</Button>
        </Section>
      )}

      <Section style={buttonContainer}>
        <Button href={BRAND.urls.account}>View Booking Details</Button>
      </Section>

      <Text style={paragraph}>
        Questions or need to reschedule? Contact us at{' '}
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

const detailBox = {
  backgroundColor: '#1c1c20',
  border: '1px solid #3a3a40',
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

const successBadge = {
  backgroundColor: BRAND.colors.success,
  color: 'white',
  padding: '4px 12px',
  borderRadius: BRAND.borderRadius.sm,
  fontSize: '12px',
  fontWeight: '600',
  display: 'inline-block',
  marginLeft: '8px',
};

const savingsText = {
  margin: '12px 0 0 0',
  fontSize: '14px',
  color: BRAND.colors.success,
};

const savingsBox = {
  backgroundColor: '#1c1c20',
  border: '1px solid #3a3a40',
  padding: BRAND.spacing.lg,
  borderRadius: BRAND.borderRadius.lg,
  margin: `${BRAND.spacing.lg} 0`,
  border: `2px solid ${BRAND.colors.success}`,
};

const savingsTitle = {
  margin: '0 0 16px 0',
  fontSize: '18px',
  fontWeight: '600',
  color: BRAND.colors.success,
};

const savingsAmount = {
  fontSize: '14px',
  fontWeight: '600',
  color: BRAND.colors.success,
};

const totalSavingsAmount = {
  fontSize: '16px',
  fontWeight: '700',
  color: BRAND.colors.success,
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

export default BookingConfirmation;
