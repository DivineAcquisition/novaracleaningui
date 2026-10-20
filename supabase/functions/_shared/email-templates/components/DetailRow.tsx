import * as React from 'https://esm.sh/react@18.3.1';
import { Row, Column, Text } from 'https://esm.sh/@react-email/components@0.0.22';

interface DetailRowProps {
  label: string;
  value: string | React.ReactNode;
  isLast?: boolean;
}

export const DetailRow = ({ label, value, isLast = false }: DetailRowProps) => {
  return (
    <Row style={isLast ? rowStyleLast : rowStyle}>
      <Column style={labelStyle}>
        <Text className="novara-label" style={labelText}>{label}</Text>
      </Column>
      <Column style={valueStyle}>
        <Text className="novara-value" style={valueText}>{value}</Text>
      </Column>
    </Row>
  );
};

const rowStyle = {
  padding: '12px 0',
  borderBottom: '1px solid #3a3a40',
};

const rowStyleLast = {
  padding: '12px 0',
};

const labelStyle = {
  width: '42%',
  verticalAlign: 'top' as const,
};

const labelText = {
  margin: '0',
  fontSize: '14px',
  fontWeight: '500',
  color: '#a1a1aa',
};

const valueStyle = {
  verticalAlign: 'top' as const,
};

const valueText = {
  margin: '0',
  fontSize: '14px',
  fontWeight: '600',
  color: '#ffffff',
  textAlign: 'right' as const,
};

export default DetailRow;
