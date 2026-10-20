// Same shell as buildEmailCard in the compliance engine.
// Header band, message, then the compliance footer slot.

import * as React from 'https://esm.sh/react@18.3.1';
import {
  Html,
  Head,
  Preview,
  Body,
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

const cardCss = `
  .novara-card p, .novara-card li, .novara-card span, .novara-card td { color:#d4d4d8 !important; }
  .novara-card h1, .novara-card h2, .novara-card h3,
  .novara-card strong, .novara-card b, .novara-card strong span, .novara-card b span { color:#ffffff !important; }
  .novara-card p[style*="font-weight:600"], .novara-card p[style*="font-weight: 600"],
  .novara-card p[style*="font-weight:700"], .novara-card p[style*="font-weight: 700"] { color:#ffffff !important; }
  .novara-card a:not(.novara-btn) { color:#ddd6fe !important; }
  .novara-card a.novara-btn { color:#18181b !important; background:#f4f4f5 !important; border-radius:999px !important; }
  .novara-card .novara-label { color:#a1a1aa !important; font-weight:500 !important; }
  .novara-card .novara-value, .novara-card .novara-value span, .novara-card .novara-value strong { color:#ffffff !important; font-weight:600 !important; }
`;

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
        <style>{cardCss}</style>
      </Head>
      <Preview>{previewText}</Preview>
      <Body style={page}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={page}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: '32px 16px' }}>
                <table data-novara-card="1" role="presentation" width="600" cellPadding={0} cellSpacing={0} style={card}>
                  <tbody>
                    <tr>
                      <td style={headerBand}>
                        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
                          <tbody>
                            <tr>
                              <td style={accent}>&nbsp;</td>
                            </tr>
                            <tr>
                              <td style={{ padding: '18px 28px' }}>
                                <Img src={BRAND.logo.url} width="40" height="40" alt="Novara Cleaning" style={logo} />
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td className="novara-card" style={bodyCell}>
                        {title ? <h1 style={heading}>{title}</h1> : null}
                        {subtitle ? <p style={subhead}>{subtitle}</p> : null}
                        {children}
                        {footerNote ? <p style={note}>{footerNote}</p> : null}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '0 12px 8px' }}>
                        <div dangerouslySetInnerHTML={{ __html: '<!--data-novara-card--><!--NOVARA_FOOTER_START--><!--NOVARA_FOOTER_END-->' }} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
};

const page = {
  margin: '0',
  padding: '0',
  backgroundColor: '#0b0b0d',
  fontFamily: 'Inter, Arial, sans-serif',
};

const card = {
  maxWidth: '600px',
  width: '100%',
  backgroundColor: '#18181b',
  border: '1px solid #2e2e33',
  borderRadius: '20px',
};

const headerBand = {
  padding: '0',
  backgroundColor: '#121214',
  borderRadius: '20px 20px 0 0',
};

const accent = {
  height: '4px',
  backgroundColor: '#7c6af7',
  fontSize: '0',
  lineHeight: '4px',
  borderRadius: '20px 20px 0 0',
};

const logo = {
  display: 'block' as const,
  width: '40px',
  height: '40px',
  borderRadius: '10px',
  border: '0',
};

const bodyCell = {
  padding: '28px 28px 8px',
  fontFamily: 'Inter, Arial, sans-serif',
};

const heading = {
  margin: '0 0 16px',
  fontFamily: 'Inter, Arial, sans-serif',
  fontSize: '28px',
  lineHeight: '1.2',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: '#ffffff',
};

const subhead = {
  margin: '0 0 18px',
  fontFamily: 'Inter, Arial, sans-serif',
  fontSize: '16px',
  lineHeight: '1.5',
  color: '#a1a1aa',
};

const note = {
  margin: '16px 0 0',
  fontSize: '13px',
  lineHeight: '1.5',
  color: '#a1a1aa',
};

export default EmailLayout;
