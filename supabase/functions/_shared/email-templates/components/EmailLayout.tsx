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
  .novara-card p, .novara-card li, .novara-card td { color:#27272A; }
  .novara-card h1, .novara-card h2, .novara-card h3, .novara-card strong, .novara-card b { color:#0B0A11; }
  .novara-card a:not(.novara-btn) { color:#5A1FD6; }
  .novara-card a.novara-btn { color:#ffffff !important; background:#6810FE !important; border-radius:999px !important; }
  .novara-card .novara-label { color:#52525B !important; font-weight:500 !important; }
  .novara-card .novara-value, .novara-card .novara-value span, .novara-card .novara-value strong { color:#0B0A11 !important; font-weight:600 !important; }
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
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
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
                      <td style={{ padding: '0 12px 8px', backgroundColor: '#ffffff', borderRadius: '0 0 20px 20px' }}>
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
  backgroundColor: '#F4F2F8',
  fontFamily: 'Inter, Arial, sans-serif',
};

const card = {
  maxWidth: '600px',
  width: '100%',
  backgroundColor: '#ffffff',
  border: '1px solid #E7E5EE',
  borderRadius: '20px',
};

const headerBand = {
  padding: '0',
  backgroundColor: '#0B0A11',
  borderRadius: '20px 20px 0 0',
};

const accent = {
  height: '4px',
  backgroundColor: '#6810FE',
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
  backgroundColor: '#ffffff',
  fontFamily: 'Inter, Arial, sans-serif',
};

const heading = {
  margin: '0 0 16px',
  fontFamily: 'Inter, Arial, sans-serif',
  fontSize: '28px',
  lineHeight: '1.2',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: '#0B0A11',
};

const subhead = {
  margin: '0 0 18px',
  fontFamily: 'Inter, Arial, sans-serif',
  fontSize: '16px',
  lineHeight: '1.5',
  color: '#52525B',
};

const note = {
  margin: '16px 0 0',
  fontSize: '13px',
  lineHeight: '1.5',
  color: '#52525B',
};

export default EmailLayout;
