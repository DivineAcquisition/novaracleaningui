import * as React from 'https://esm.sh/react@18.3.1';
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
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
      <Head>
        <style>{`
          .novara-card p, .novara-card li, .novara-card span, .novara-card td { color: #d4d4d8 !important; }
          .novara-card a:not(.novara-btn) { color: #ddd6fe !important; }
          .novara-card a.novara-btn { color: #18181b !important; background: #e7e7ea !important; }
        `}</style>
      </Head>
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={card} className="novara-card" data-novara-card="1">
            <Section style={accent} />
            <Section style={inner}>
              <Img
                src={BRAND.logo.url}
                width="56"
                height="56"
                alt={`${BRAND.name} logo`}
                style={logo}
              />
              <Text style={headerTitle}>{title}</Text>
              {subtitle && <Text style={headerSubtitle}>{subtitle}</Text>}
              <Section style={content}>{children}</Section>
              {footerNote && <Text style={note}>{footerNote}</Text>}
              <div dangerouslySetInnerHTML={{ __html: "<!--data-novara-card--><!--NOVARA_FOOTER_START--><!--NOVARA_FOOTER_END-->" }} />
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const main = {
  backgroundColor: '#141416',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const container = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '28px 12px',
};

const card = {
  backgroundColor: '#2a2a2e',
  border: '1px solid #3a3a40',
  borderRadius: '16px',
  overflow: 'hidden',
};

const accent = {
  backgroundColor: '#7c6af7',
  height: '3px',
  lineHeight: '3px',
  fontSize: '0',
};

const inner = {
  padding: '28px 28px 24px',
};

const logo = {
  display: 'block',
  width: '56px',
  height: '56px',
  borderRadius: '12px',
  margin: '0 0 22px',
};

const headerTitle = {
  margin: '0 0 14px',
  fontSize: '28px',
  lineHeight: '1.2',
  fontWeight: '700',
  color: '#ffffff',
  fontFamily: 'Inter, Arial, sans-serif',
};

const headerSubtitle = {
  margin: '-6px 0 16px',
  fontSize: '16px',
  lineHeight: '1.5',
  color: '#b4b4bc',
};

const content = {
  color: '#d4d4d8',
};

const note = {
  margin: '16px 0 0',
  fontSize: '13px',
  lineHeight: '1.5',
  color: '#a1a1aa',
};

export default EmailLayout;
