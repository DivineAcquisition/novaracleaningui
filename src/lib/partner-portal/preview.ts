import { computeCancelFee } from "./cancel-fee";

export const PREVIEW_TOKENS = [
  "preview-host",
  "preview-commercial",
  "preview-property-manager",
  "preview-mixed",
] as const;
export type PreviewKind = "host" | "commercial" | "property_manager" | "mixed";

export function previewKindFromToken(token: string): PreviewKind | null {
  if (token === "preview-host") return "host";
  if (token === "preview-commercial") return "commercial";
  if (token === "preview-property-manager") return "property_manager";
  if (token === "preview-mixed") return "mixed";
  return null;
}

export function isPreviewQuery(value: string | null | undefined): PreviewKind | null {
  if (value === "host" || value === "commercial" || value === "property_manager" || value === "mixed") {
    return value;
  }
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
  const propertyManager = {
    id: "preview-pm-1",
    companyName: "Keystone Residential Management",
    contactName: "Jordan Hale",
    email: "jordan@example.com",
    phone: null,
    status: "active",
    billingMethod: "invoiced" as const,
    invoiceCycle: "monthly",
    netTerms: "net_15",
    volumeDiscountPercent: 8,
    volumeDiscountLabel: "Portfolio 10+",
  };
  const kinds: string[] =
    kind === "mixed"
      ? ["host", "commercial", "property_manager"]
      : kind === "host"
        ? ["host"]
        : kind === "property_manager"
          ? ["property_manager"]
          : ["commercial"];
  return {
    ok: true,
    preview: true,
    email: "jordan@example.com",
    displayName: "Jordan Hale",
    kinds,
    hosts: kind === "host" || kind === "mixed" ? [host] : [],
    accounts: kind === "commercial" || kind === "mixed" ? [account] : [],
    propertyManagers: kind === "property_manager" || kind === "mixed" ? [propertyManager] : [],
    sessionDays: 30,
  };
}

export function previewHostOverview() {
  const date = tomorrow();
  const fee = computeCancelFee({ requestedDate: date, windowStart: "11:00", priceCents: 16500 });
  return {
    ok: true,
    preview: true,
    host: {
      ...previewMe("host").hosts[0],
      paymentBrand: "visa",
      paymentLast4: "4242",
      canUpdatePayment: true,
    },
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
      { label: "Host Partnership Agreement — signed 2026-08-01", url: "/host-partnership-agreement", date: "2026-08-01", kind: "agreement" },
      { label: "Property & Rate Schedule (current, Company-set)", url: "/api/partner-portal/host?preview=host&download=rate_schedule", date: "2026-08-01", kind: "rate_schedule" },
    ],
  };
}

export function previewPropertyManagerOverview() {
  const unit = (
    id: string,
    label: string,
    address: string,
    sqft: number,
    beds: number,
    baths: number,
    moveOut: number,
    standard: number,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    label,
    unitLabel: label,
    address,
    city: "Baltimore",
    state: "MD",
    zipCode: "21231",
    sqft,
    bedrooms: beds,
    bathrooms: baths,
    zoneCode: "core",
    rates: [
      { service: "move_out", label: "Move-Out", standingCents: moveOut, listCents: Math.round(moveOut / 0.92) },
      { service: "move_in", label: "Move-In", standingCents: moveOut, listCents: Math.round(moveOut / 0.92) },
      {
        service: "standard",
        label: "Standard (vacant refresh)",
        standingCents: standard,
        listCents: Math.round(standard / 0.92),
      },
    ],
    discountPercent: 8,
    ratesComputedAt: "2026-08-01T12:00:00Z",
    status: "active",
    reviewReason: null,
    reviewMessage: null,
    bookable: true,
    accessOnFile: true,
    accessMethod: "Lockbox",
    accessNotes: null,
    parkingNotes: null,
    notes: null,
    rateEditable: false as const,
    turnoverCount: 3,
    upcomingCount: 1,
    lastServicedOn: "2026-08-14",
    nextNeededBy: tomorrow(),
    ...extra,
  });

  return {
    ok: true,
    preview: true,
    account: {
      id: "preview-pm-1",
      companyName: "Keystone Residential Management",
      contactName: "Jordan Hale",
      status: "active",
      unitCount: 12,
      pendingReviewCount: 1,
      upcomingTurnovers: 2,
      agreementSigned: true,
    },
    discount: {
      percent: 8,
      label: "Portfolio 10+",
      unitsToNextTier: 8,
      nextPercent: 12,
      note: "Your 8% portfolio discount is already reflected in every standing rate below.",
    },
    billing: {
      method: "invoiced" as const,
      invoiceCycle: "monthly",
      netTerms: "net_15",
      netTermsLabel: "Net 15",
      cardOnFile: false,
      paymentBrand: null,
      paymentLast4: null,
      canUpdatePayment: false,
      invoices: [
        {
          id: "pmi_1",
          periodLabel: "August 2026",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          amountCents: 141_00,
          unitCount: 3,
          turnoverCount: 5,
          status: "outstanding" as const,
          statusLabel: "Due",
          dueDate: "2026-09-15",
          url: "https://invoice.stripe.com/preview",
          units: [
            {
              unitId: "u1",
              unitLabel: "Adams St 2B",
              address: "118 Adams St",
              subtotalCents: 64_40,
              turnovers: [
                {
                  turnoverId: "t1",
                  serviceType: "move_out",
                  serviceLabel: "Move-Out",
                  servicedOn: "2026-08-14",
                  amountCents: 322_00,
                  scopeAdjustmentCents: 0,
                },
              ],
            },
          ],
        },
      ],
    },
    services: [
      { key: "move_out", label: "Move-Out", summary: "Full turnover clean after a tenant vacates." },
      {
        key: "move_in",
        label: "Move-In",
        summary: "Move-in ready clean before a new tenant takes possession.",
      },
      {
        key: "standard",
        label: "Standard (vacant refresh)",
        summary: "Refresh on a vacant unit between showings.",
      },
    ],
    units: [
      unit("u1", "Adams St 2B", "118 Adams St", 980, 2, 1, 322_00, 184_00),
      unit("u2", "Adams St 3A", "118 Adams St", 1240, 3, 2, 391_00, 223_00),
      unit("u3", "Canton Row 4", "2400 Boston St", 1450, 3, 2, 428_00, 244_00, {
        status: "pending_review",
        bookable: false,
        reviewReason: "flagged_non_standard",
        reviewMessage:
          "You flagged this unit as non-standard, so it's with our team rather than auto-priced.",
        rates: [
          { service: "move_out", label: "Move-Out", standingCents: null, listCents: null },
          { service: "move_in", label: "Move-In", standingCents: null, listCents: null },
          { service: "standard", label: "Standard (vacant refresh)", standingCents: null, listCents: null },
        ],
      }),
    ],
    selectedUnitId: null,
    turnovers: [
      {
        id: "t1",
        unitId: "u1",
        unitLabel: "Adams St 2B",
        serviceType: "move_out",
        serviceLabel: "Move-Out",
        neededByDate: tomorrow(),
        neededByTime: null,
        deadlineLabel: `${tomorrow()} (end of day)`,
        scheduledDate: tomorrow(),
        status: "assigned",
        statusLabel: "Scheduled",
        priceCents: 322_00,
        finalPriceCents: null,
        scopeAdjustmentCents: 0,
        chargedCents: 322_00,
        notes: "Tenant left the 1st. New lease starts the 5th.",
        completedAt: null,
        invoiceId: null,
        createdAt: new Date().toISOString(),
        beforePhotos: [],
        afterPhotos: [],
      },
    ],
    documents: [
      {
        label: "Property Management Services Agreement — signed 2026-08-01",
        url: null,
        date: "2026-08-01",
        kind: "agreement",
      },
      {
        label: "Unit Registry & Standing Rates (current, Company-set)",
        url: "/api/partner-portal/property-manager?preview=property_manager&download=unit_registry",
        date: "2026-08-01",
        kind: "unit_registry",
      },
    ],
    rateEditable: false as const,
  };
}

export function previewCommercialOverview(method: "auto_pay" | "invoiced" = "auto_pay") {
  const invoiced = method === "invoiced";
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
      method,
      cardOnFile: invoiced ? false : true,
      paymentBrand: invoiced ? null : "visa",
      paymentLast4: invoiced ? null : "4242",
      canUpdatePayment: !invoiced,
      netTerms: invoiced ? "net_15" : null,
      netTermsLabel: invoiced ? "Net 15" : null,
      invoiceCycle: invoiced ? "monthly" : null,
      invoices: invoiced
        ? [
            { id: "in_1", date: "2026-08-01", amountCents: 28500, url: "https://invoice.stripe.com/preview", status: "paid", dueDate: "2026-08-16" },
            { id: "in_2", date: "2026-08-20", amountCents: 28500, url: "https://invoice.stripe.com/preview", status: "outstanding", dueDate: "2026-09-04" },
            { id: "in_3", date: "2026-07-01", amountCents: 28500, url: null, status: "overdue", dueDate: "2026-07-16" },
          ]
        : [],
      charges: invoiced
        ? []
        : [{ id: "b1", date: "2026-08-20", amountCents: 28500, url: null, status: "paid", dueDate: "2026-08-20" }],
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
        lastVisit: "2026-08-20",
        zones: [
          { id: "z1", name: "Reception", description: "Lobby and front desk", status: "complete" as const, note: "", before: [], after: [] },
          { id: "z2", name: "Open office", description: "Workstations", status: "complete" as const, note: "", before: [], after: [] },
        ],
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
      {
        id: "v2",
        bookingNumber: 1043,
        status: "scheduled",
        serviceDate: tomorrow(),
        timeSlot: "evening",
        arrivalWindow: "6–10pm",
        address: "2400 Boston St",
        city: "Baltimore",
        amountCents: 10000,
        invoiceUrl: null,
        isRecurring: true,
        frequency: "weekly",
        completedAt: null,
        beforePhotos: [],
        afterPhotos: [],
        siteId: "s2",
      },
    ],
    documents: [
      { label: "Commercial Cleaning Services Agreement — signed 2026-08-10", url: null, date: "2026-08-10", kind: "agreement" },
      { label: "Exhibit A — Schedule of Sites (as signed)", url: "/api/partner-portal/commercial?preview=commercial&download=exhibit_a", date: "2026-08-10", kind: "exhibit_a" },
      { label: "Certificate of Insurance (current)", url: "/commercial/novara-certificate-of-insurance.pdf", date: "2027-07-21", kind: "coi" },
    ],
  };
}
