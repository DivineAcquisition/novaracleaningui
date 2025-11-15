import * as React from 'https://esm.sh/react@18.3.1';
import { Section } from 'https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1,react-dom@18.3.1';
import { BRAND } from '../brand.ts';

interface HighlightProps {
  children: React.ReactNode;
  variant?: 'info' | 'success' | 'warning' | 'danger';
}

export const Highlight = ({ children, variant = 'info' }: HighlightProps) => {
  const styles = {
    info: {
      backgroundColor: BRAND.colors.gray[100],
      borderLeft: `4px solid ${BRAND.colors.primary}`,
    },
    success: {
      backgroundColor: '#D1FAE5',
      borderLeft: `4px solid ${BRAND.colors.success}`,
    },
    warning: {
      backgroundColor: '#FEF3C7',
      borderLeft: `4px solid ${BRAND.colors.warning}`,
    },
    danger: {
      backgroundColor: '#FEE2E2',
      borderLeft: `4px solid ${BRAND.colors.danger}`,
    },
  };

  return (
    <Section style={{ ...baseStyle, ...styles[variant] }}>
      {children}
    </Section>
  );
};

const baseStyle = {
  padding: BRAND.spacing.lg,
  borderRadius: BRAND.borderRadius.sm,
  margin: `${BRAND.spacing.lg} 0`,
};

export default Highlight;
