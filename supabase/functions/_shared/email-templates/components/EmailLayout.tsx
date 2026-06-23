import * as React from 'https://esm.sh/react@18.3.1';
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
  Link,
  Img,
} from 'https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1,react-dom@18.3.1';
import { BRAND } from '../brand.ts';

interface EmailLayoutProps {
  title: string;
  subtitle?: string;
  previewText: string;
  children: React.ReactNode;
  footerNote?: string;
}

export const EmailLayout = ({
  title,
  subtitle,
  previewText,
  children,
  footerNote,
}: EmailLayoutProps) => {
  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Logo bar — sits in a white pre-header so the Novara mark
              stays legible regardless of inbox dark-mode handling. The
              gradient title bar below picks up the brand color cue. */}
          <Section style={logoBar}>
            {BRAND.logo.url && (
              <Img
                src={BRAND.logo.url}
                width={BRAND.logo.width}
                height={BRAND.logo.height}
                alt={`${BRAND.name} logo`}
                style={logo}
              />
            )}
          </Section>

          {/* Title bar — brand-gradient strip above the body content. */}
          <Section style={header}>
            <Text style={headerTitle}>{title}</Text>
            {subtitle && <Text style={headerSubtitle}>{subtitle}</Text>}
          </Section>

          {/* Content */}
          <Section style={content}>{children}</Section>

          {/* Footer */}
          <Section style={footer}>
            {footerNote && (
              <Text style={footerText}>{footerNote}</Text>
            )}
            <Text style={footerText}>
              © {new Date().getFullYear()} {BRAND.name}. All rights reserved.
            </Text>
            <Text style={footerLinks}>
              <Link href={BRAND.urls.website} style={footerLink}>
                Website
              </Link>
              {' • '}
              <Link href={BRAND.urls.account} style={footerLink}>
                My Account
              </Link>
              {' • '}
              <Link href={`mailto:${BRAND.contact.email}`} style={footerLink}>
                Contact
              </Link>
            </Text>
            <Text style={footerLinks}>
              <Link href={BRAND.urls.terms} style={footerLink}>
                Terms of Service
              </Link>
              {' • '}
              <Link href={BRAND.urls.privacy} style={footerLink}>
                Privacy Policy
              </Link>
              {' • '}
              <Link href={BRAND.urls.cancellation} style={footerLink}>
                Cancellation Policy
              </Link>
              {' • '}
              <Link href={BRAND.urls.membershipPolicy} style={footerLink}>
                Membership Terms
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const main = {
  backgroundColor: '#F9FAFB',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const container = {
  maxWidth: '600px',
  margin: '0 auto',
  padding: '20px',
};

const logo = {
  display: 'block',
  margin: '0 auto',
};

const logoBar = {
  backgroundColor: '#ffffff',
  padding: '20px 20px 12px',
  textAlign: 'center' as const,
  borderRadius: '8px 8px 0 0',
  border: `1px solid ${BRAND.colors.gray[200]}`,
  borderBottom: 'none',
};

const header = {
  background: BRAND.gradient.primary,
  color: 'white',
  padding: '26px 30px',
  textAlign: 'center' as const,
  borderLeft: `1px solid ${BRAND.colors.gray[200]}`,
  borderRight: `1px solid ${BRAND.colors.gray[200]}`,
};

const headerTitle = {
  margin: '0',
  fontSize: '28px',
  fontWeight: 'bold',
  color: 'white',
};

const headerSubtitle = {
  margin: '10px 0 0 0',
  fontSize: '18px',
  color: 'white',
  opacity: 0.95,
};

const content = {
  backgroundColor: '#ffffff',
  padding: '30px',
  border: `1px solid ${BRAND.colors.gray[200]}`,
  borderTop: 'none',
};

const footer = {
  textAlign: 'center' as const,
  padding: '20px',
  backgroundColor: '#ffffff',
  borderRadius: '0 0 8px 8px',
  border: `1px solid ${BRAND.colors.gray[200]}`,
  borderTop: 'none',
};

const footerText = {
  margin: '8px 0',
  fontSize: '14px',
  color: BRAND.colors.gray[600],
};

const footerLinks = {
  margin: '12px 0',
  fontSize: '14px',
  color: BRAND.colors.gray[600],
};

const footerLink = {
  color: BRAND.colors.primary,
  textDecoration: 'none',
};

export default EmailLayout;
