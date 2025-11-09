import * as React from 'https://esm.sh/react@18.3.1';
import { Link } from 'https://esm.sh/@react-email/components@0.0.22';
import { BRAND } from '../brand.ts';

interface ButtonProps {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}

export const Button = ({ href, children, variant = 'primary' }: ButtonProps) => {
  return (
    <Link href={href} style={variant === 'primary' ? buttonPrimary : buttonSecondary}>
      {children}
    </Link>
  );
};

const buttonPrimary = {
  display: 'inline-block',
  background: BRAND.gradient.primary,
  color: 'white',
  padding: '16px 40px',
  textDecoration: 'none',
  borderRadius: BRAND.borderRadius.md,
  fontWeight: '600',
  fontSize: '16px',
  textAlign: 'center' as const,
};

const buttonSecondary = {
  display: 'inline-block',
  backgroundColor: BRAND.colors.gray[100],
  color: BRAND.colors.gray[900],
  padding: '12px 32px',
  textDecoration: 'none',
  borderRadius: BRAND.borderRadius.md,
  fontWeight: '600',
  fontSize: '14px',
  textAlign: 'center' as const,
};

export default Button;
