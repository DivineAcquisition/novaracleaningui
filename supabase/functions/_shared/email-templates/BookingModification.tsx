import * as React from 'https://esm.sh/react@18.3.1';
import { Body, Container, Head, Heading, Html, Preview, Section, Text } from 'https://esm.sh/@react-email/components@0.0.22';
import { EmailLayout } from './components/EmailLayout.tsx';
import { Button } from './components/Button.tsx';
import { DetailRow } from './components/DetailRow.tsx';
import { Highlight } from './components/Highlight.tsx';
import { BRAND } from './brand.ts';

interface BookingModificationProps {
  bookingData: {
    first_name: string;
    last_name: string;
    service_type: string;
    add_ons?: string[];
    service_date: string;
    time_slot: string;
    address: string;
    city: string;
    state: string;
    zip_code: string;
    bedrooms?: number;
    bathrooms?: number;
    dwelling_type?: string;
    total_estimate_cents: number;
    priceDifference?: string;
  };
}

const SERVICE_LABELS: Record<string, string> = {
  standard: 'Standard Cleaning',
  deep: 'Deep Clean',
  moveInOut: 'Move-In/Out Cleaning',
};

const ADD_ON_LABELS: Record<string, string> = {
  fridge: 'Inside Fridge',
  oven: 'Inside Oven',
  windows: 'Interior Windows',
  laundry: 'Laundry — wash & fold',
  changeLinens: 'Change bed linens',
  dishes: 'Dishes & kitchen cleanup',
  baseboards: 'Baseboards (hand-wiped)',
  blinds: 'Blinds & shutters',
  cabinets: 'Inside cabinets',
  walls: 'Spot wall washing',
  ceilingFans: 'Ceiling fans',
  microwave: 'Inside microwave',
  dishwasher: 'Inside dishwasher',
  garage: 'Garage sweep-out',
  patio: 'Patio / balcony',
  petHair: 'Heavy pet-hair removal',
  closets: 'Inside closets / tidy',
  trashHaul: 'Trash haul',
  deepBathroomDetail: 'Deep bathroom detail',
  basement: 'Basement clean',
};

export const BookingModification = ({ bookingData }: BookingModificationProps) => {
  const {
    first_name,
    last_name,
    service_type,
    add_ons = [],
    service_date,
    time_slot,
    address,
    city,
    state,
    zip_code,
    bedrooms,
    bathrooms,
    dwelling_type,
    total_estimate_cents,
    priceDifference,
  } = bookingData;

  const formattedDate = new Date(service_date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const priceDiff = priceDifference ? parseFloat(priceDifference) : 0;

  return (
    <EmailLayout 
      title="Booking Updated - NovaraCleaning"
      previewText="Your cleaning service has been updated"
    >
      <Head>
        <title>Booking Modified - NovaraCleaning</title>
      </Head>
      <Preview>Your cleaning service has been updated</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Booking Updated!</Heading>
          
          <Text style={text}>
            Hi {first_name},
          </Text>
          
          <Text style={text}>
            We've successfully updated your cleaning service. Here are the new details:
          </Text>

          <Highlight variant="success">
            <Text style={{ margin: 0, fontWeight: 'bold', fontSize: '16px' }}>
              {formattedDate}
            </Text>
            <Text style={{ margin: '4px 0 0 0', fontSize: '14px' }}>
              {time_slot}
            </Text>
          </Highlight>

          <Section style={detailsSection}>
            <Heading style={h2}>Updated Service Details</Heading>
            <DetailRow label="Service Type" value={SERVICE_LABELS[service_type] || service_type} />
            {add_ons.length > 0 && (
              <DetailRow 
                label="Add-ons" 
                value={add_ons.map(addon => ADD_ON_LABELS[addon] || addon).join(', ')} 
              />
            )}
            <DetailRow label="Location" value={`${address}, ${city}, ${state} ${zip_code}`} />
            {dwelling_type && <DetailRow label="Dwelling Type" value={dwelling_type} />}
            {bedrooms && <DetailRow label="Bedrooms" value={bedrooms.toString()} />}
            {bathrooms && <DetailRow label="Bathrooms" value={bathrooms.toString()} />}
          </Section>

          <Section style={pricingSection}>
            <Heading style={h2}>Updated Pricing</Heading>
            <div style={priceRow}>
              <Text style={priceLabel}>New Total:</Text>
              <Text style={priceValue}>${(total_estimate_cents / 100).toFixed(2)}</Text>
            </div>
            {priceDiff !== 0 && (
              <div style={priceRow}>
                <Text style={priceLabel}>
                  {priceDiff > 0 ? 'Additional Charge:' : 'Refund:'}
                </Text>
                <Text style={{
                  ...priceValue,
                  color: priceDiff > 0 ? BRAND.colors.danger : BRAND.colors.success,
                }}>
                  {priceDiff > 0 ? '+' : ''}${Math.abs(priceDiff).toFixed(2)}
                </Text>
              </div>
            )}
          </Section>

          {priceDiff < 0 && (
            <Highlight variant="success">
              <Text style={{ margin: 0 }}>
                A refund of ${Math.abs(priceDiff).toFixed(2)} will be processed to your original payment method within 5-7 business days.
              </Text>
            </Highlight>
          )}

          <Section style={ctaSection}>
            <Button href={`https://app.novaracleaning.com/account`}>
              View My Account
            </Button>
          </Section>

          <Text style={footer}>
            Need to make more changes? Visit your account dashboard or contact us at{' '}
            <a href="mailto:hello@novaracleaning.com" style={link}>
              hello@novaracleaning.com
            </a>
          </Text>
        </Container>
      </Body>
    </EmailLayout>
  );
};

export default BookingModification;

const main = {
  backgroundColor: '#f8fafc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const container = {
  margin: '0 auto',
  padding: '20px 0',
  maxWidth: '600px',
};

const h1 = {
  color: BRAND.colors.gray[900],
  fontSize: '28px',
  fontWeight: '700',
  margin: '30px 0',
  padding: '0',
  lineHeight: '1.3',
};

const h2 = {
  color: BRAND.colors.gray[900],
  fontSize: '20px',
  fontWeight: '600',
  margin: '24px 0 16px',
  padding: '0',
};

const text = {
  color: BRAND.colors.gray[700],
  fontSize: '16px',
  lineHeight: '1.6',
  margin: '16px 0',
};

const detailsSection = {
  backgroundColor: 'white',
  borderRadius: BRAND.borderRadius.lg,
  padding: BRAND.spacing.lg,
  margin: `${BRAND.spacing.xl} 0`,
  border: `1px solid ${BRAND.colors.gray[200]}`,
};

const pricingSection = {
  backgroundColor: '#f1f5f9',
  borderRadius: BRAND.borderRadius.lg,
  padding: BRAND.spacing.lg,
  margin: `${BRAND.spacing.xl} 0`,
};

const priceRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  margin: '12px 0',
};

const priceLabel = {
  fontSize: '16px',
  color: BRAND.colors.gray[700],
  margin: 0,
};

const priceValue = {
  fontSize: '20px',
  fontWeight: '700',
  color: BRAND.colors.gray[900],
  margin: 0,
};

const ctaSection = {
  textAlign: 'center' as const,
  margin: `${BRAND.spacing.xl} 0`,
};

const footer = {
  color: BRAND.colors.gray[600],
  fontSize: '14px',
  lineHeight: '1.6',
  marginTop: BRAND.spacing.xl,
  paddingTop: BRAND.spacing.lg,
  borderTop: `1px solid ${BRAND.colors.gray[200]}`,
};

const link = {
  color: BRAND.colors.primary,
  textDecoration: 'none',
};
