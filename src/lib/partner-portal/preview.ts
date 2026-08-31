import { computeCancelFee } from "./cancel-fee";

export const PREVIEW_TOKENS = ["preview-host", "preview-commercial", "preview-mixed"] as const;
export type PreviewKind = "host" | "commercial" | "mixed";

export function previewKindFromToken(token: string): PreviewKind | null {
  if (token === "preview-host") return "host";
  if (token === "preview-commercial") return "commercial";
  if (token === "preview-mixed") return "mixed";
  return null;
}

export function isPreviewQuery(value: string | null | undefined): PreviewKind | null {
  if (value === "host" || value === "commercial" || value === "mixed") return value;
  return previewKindFromToken(String(value || ""));
}

const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
};

export function previewMe(kind: PreviewKind) {
  const host = {
    id: "preview-host-1",
    name: "Jordan Hale",
    email: "jordan@example.com",
    status: "active",
    paymentOption: "full",
    cardOnFile: true,
    payAfterEnabled: false,
  };
  const account = {
    id: "preview-acct-1",
    businessName: "Harbor Offices LLC",
    contactName: "Jordan Hale",
    email: "jordan@example.com",
    phone: null,
    status: "active",
    accountType: "commercial",
    billingMethod: "auto_pay" as const,
  };
  return {
    ok: true,
    preview: true,
    email: "jordan@example.com",
    displayName: "Jordan Hale",
    kinds: kind === "mixed" ? (["host", "commercial"] as const) : kind === "host" ? (["host"] as const) : (["commercial"] as const),
    hosts: kind === "commercial" ? [] : [host],
    accounts: kind === "host" ? [] : [account],
    sessionDays: 30,
  };
}

export function previewHostOverview() {
  const date = tomorrow();
  const fee = computeCancelFee({ requestedDate: date, windowStart: "11:00", priceCents: 16500 });
  return {
    ok: true,
    preview: true,
    host: previewMe("host").hosts[0],
    properties: [
      {
        id: "p1",
        nickname: "Fells Point 2BR",
        address: "812 S Broadway, Baltimore, MD",
        bedrooms: 2,
        bathrooms: 2,
        sqft: 1100,
        laundryIncluded: true,
        restockIncluded: true,
        turnoverPrice: 165,
        rateEditable: false,
        notes: null,
      },
    ],
    turnovers: [
      {
        id: "t1",
        propertyId: "p1",
        requestedDate: date,
        windowStart: "11:00",
        windowEnd: "15:00",
        price: 165,
        status: "scheduled",
        statusLabel: "Scheduled",
        paymentOption: "full",
        paidAt: new Date().toISOString(),
        completedAt: null,
        createdAt: new Date().toISOString(),
        beforePhotos: [],
        afterPhotos: [],
        invoiceUrl: null,
        invoicedAt: null,
        cancelFee: fee,
        recordedCancelFeeCents: null,
        recordedCancelTier: null,
        hostRating: null,
      },
    ],
    documents: [
      { label: "Host Partnership Agreement — signed 2026-08-01", url: "/host-partnership-agreement", date: "2026-08-01" },
      { label: "Property & Rate Schedule — 2026-08-01", url: "/host-partnership-agreement", date: "2026-08-01" },
    ],
  };
}

export function previewCommercialOverview() {
  return {
    ok: true,
    preview: true,
    account: {
      id: "preview-acct-1",
      businessName: "Harbor Offices LLC",
      contactName: "Jordan Hale",
      status: "active",
      accountType: "commercial",
      facilityType: "office",
      frequency: "weekly",
      siteCount: 2,
      upcomingThisPeriod: 3,
      upcomingTotal: 4,
      agreementSigned: true,
      billingConfigured: true,
      contractValueCents: 28500,
      term: "12_month",
    },
    billing: {
      method: "auto_pay" as const,
      cardOnFile: true,
      netTerms: null,
      invoiceCycle: null,
      invoices: [],
      charges: [
        { id: "b1", date: "2026-08-20", amountCents: 28500, url: null, status: "paid", dueDate: "2026-08-20" },
      ],
    },
    coi: {
      status: "current" as const,
      expiresLabel: "July 21, 2027",
      expirationDate: "2027-07-21",
      href: "/commercial/novara-certificate-of-insurance.pdf",
    },
    sites: [
      {
        id: "s1",
        nickname: "Harbor East office",
        address: "1000 Lancaster St",
        city: "Baltimore",
        state: "MD",
        facilityType: "office",
        scopeLevel: "standard",
        sqft: 4200,
        serviceWindowStart: "18:00",
        serviceWindowEnd: "22:00",
        upcomingCount: 2,
      },
      {
        id: "s2",
        nickname: "Canton suite",
        address: "2400 Boston St",
        city: "Baltimore",
        state: "MD",
        facilityType: "office",
        scopeLevel: "light",
        sqft: 1800,
        serviceWindowStart: "18:00",
        serviceWindowEnd: "21:00",
        upcomingCount: 2,
      },
    ],
    selectedSite: null,
    visits: [
      {
        id: "v1",
        bookingNumber: 1042,
        status: "scheduled",
        serviceDate: tomorrow(),
        timeSlot: "evening",
        arrivalWindow: "6–10pm",
        address: "1000 Lancaster St",
        city: "Baltimore",
        amountCents: 18500,
        invoiceUrl: null,
        isRecurring: true,
        frequency: "weekly",
        completedAt: null,
        beforePhotos: [],
        afterPhotos: [],
        siteId: "s1",
      },
    ],
    documents: [
      { label: "Commercial Cleaning Services Agreement — signed 2026-08-10", url: null, date: "2026-08-10" },
      { label: "Certificate of Insurance (current)", url: "/commercial/novara-certificate-of-insurance.pdf", date: "2027-07-21" },
    ],
  };
}
