import * as React from 'https://esm.sh/react@18.3.1';
import { Row, Column, Text } from 'https://esm.sh/@react-email/components@0.0.22';
import { BRAND } from '../brand.ts';

interface DetailRowProps {
  label: string;
  value: string | React.ReactNode;
  isLast?: boolean;
}

export const DetailRow = ({ label, value, isLast = false }: DetailRowProps) => {
  return (
    <Row style={isLast ? rowStyleLast : rowStyle}>
      <Column style={labelStyle}>
        <Text style={labelText}>{label}</Text>
      </Column>
      <Column style={valueStyle}>
        <Text style={valueText}>{value}</Text>
      </Column>
    </Row>
  );
};

const rowStyle = {
  padding: '12px 0',
  borderBottom: `1px solid ${BRAND.colors.gray[200]}`,
};

const rowStyleLast = {
  padding: '12px 0',
};

const labelStyle = {
  width: '140px',
  verticalAlign: 'top',
};

const labelText = {
  margin: '0',
  fontSize: '14px',
  fontWeight: '600',
  color: BRAND.colors.gray[600],
};

const valueStyle = {
  verticalAlign: 'top',
};

const valueText = {
  margin: '0',
  fontSize: '14px',
  color: BRAND.colors.gray[900],
};

export default DetailRow;
