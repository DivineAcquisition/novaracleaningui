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
      backgroundColor: '#F6F3FF',
      borderLeft: '4px solid #6810FE',
    },
    success: {
      backgroundColor: '#F6F3FF',
      borderLeft: `4px solid ${BRAND.colors.success}`,
    },
    warning: {
      backgroundColor: '#F6F3FF',
      borderLeft: `4px solid ${BRAND.colors.warning}`,
    },
    danger: {
      backgroundColor: '#F6F3FF',
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
  borderRadius: '12px',
  margin: `${BRAND.spacing.lg} 0`,
};

export default Highlight;
