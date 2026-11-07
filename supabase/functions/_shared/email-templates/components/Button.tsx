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
    <Link href={href} className="novara-btn" style={variant === 'primary' ? buttonPrimary : buttonSecondary}>
      {children}
    </Link>
  );
};

const buttonPrimary = {
  display: 'inline-block',
  backgroundColor: '#6810FE',
  color: '#ffffff',
  padding: '14px 28px',
  textDecoration: 'none',
  borderRadius: '999px',
  fontWeight: '600',
  fontSize: '16px',
  textAlign: 'center' as const,
  fontFamily: 'Inter, Arial, sans-serif',
};

const buttonSecondary = {
  display: 'inline-block',
  backgroundColor: '#F6F3FF',
  color: '#5A1FD6',
  border: '1px solid #E2D8FF',
  padding: '12px 28px',
  textDecoration: 'none',
  borderRadius: '999px',
  fontWeight: '600',
  fontSize: '14px',
  textAlign: 'center' as const,
};

export default Button;
