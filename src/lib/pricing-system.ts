export interface HomeSizeRange {
  id: string;
  label: string;
  minSqft: number;
  maxSqft: number;
  bedroomRange: string;
  regularPrice: number;
  deepPrice: number;
  moveInOutPrice: number;
}

export const HOME_SIZE_RANGES: HomeSizeRange[] = [
  {
    id: '1000_1500',
    label: '1,000 – 1,500 sq ft',
    minSqft: 1000,
    maxSqft: 1500,
    bedroomRange: '1–2 BR condos/homes',
    regularPrice: 129,
    deepPrice: 219,
    moveInOutPrice: 289,
  },
  {
    id: '1500_2000',
    label: '1,500 – 2,000 sq ft',
    minSqft: 1500,
    maxSqft: 2000,
    bedroomRange: '2–3 BR apartments/townhomes',
    regularPrice: 159,
    deepPrice: 259,
    moveInOutPrice: 339,
  },
  {
    id: '2000_2500',
    label: '2,000 – 2,500 sq ft',
    minSqft: 2000,
    maxSqft: 2500,
    bedroomRange: '3–4 BR homes',
    regularPrice: 189,
    deepPrice: 299,
    moveInOutPrice: 389,
  },
  {
    id: '2500_3000',
    label: '2,500 – 3,000 sq ft',
    minSqft: 2500,
    maxSqft: 3000,
    bedroomRange: '4–5 BR homes',
    regularPrice: 219,
    deepPrice: 339,
    moveInOutPrice: 439,
  },
  {
    id: '3000_plus',
    label: '3,000+ sq ft',
    minSqft: 3000,
    maxSqft: 999999,
    bedroomRange: '5+ BR large homes',
    regularPrice: 259,
    deepPrice: 399,
    moveInOutPrice: 519,
  },
];

export const FREQUENCY_DISCOUNTS = {
  one_time: { label: 'One-time', discount: 0 },
  weekly: { label: 'Weekly', discount: 0.15 },
  biweekly: { label: 'Bi-weekly', discount: 0.10 },
  monthly: { label: 'Monthly', discount: 0.05 },
};

export function calculatePrice(
  homeSizeId: string,
  serviceType: string,
  frequency: string
): number {
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
  if (!homeSize) return 0;

  let basePrice = 0;
  switch (serviceType) {
    case 'regular':
      basePrice = homeSize.regularPrice;
      break;
    case 'deep':
      basePrice = homeSize.deepPrice;
      break;
    case 'move_in_out':
      basePrice = homeSize.moveInOutPrice;
      break;
    default:
      basePrice = homeSize.regularPrice;
  }

  const frequencyData = FREQUENCY_DISCOUNTS[frequency as keyof typeof FREQUENCY_DISCOUNTS];
  const discount = frequencyData?.discount || 0;
  
  return Math.round(basePrice * (1 - discount));
}
