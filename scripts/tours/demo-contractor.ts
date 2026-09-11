// ─── Demo dataset for the contractor walkthrough recordings ─────────────────
//
// EVERY person, address, phone number, email and payment figure in this file
// is invented. Nothing here is copied from the production database, and the
// recorder serves ONLY this data to the browser (see mock.ts) — a recording
// physically cannot contain a real client, contractor or payout, because the
// real database is never contacted during a capture.
//
// That holds even though the finished clips sit behind authentication. "Only
// staff can see it" is not a reason to put a real client's address in a
// training video that then gets linked, embedded, and forwarded for years.
//
// Same conventions as the admin capture dataset (scripts/docs/capture/
// demo-data.ts), so a reader recognises the shape:
//   • emails end in @example.test (a reserved, non-routable TLD)
//   • phone numbers use the 555-01xx block reserved for fiction
//   • street addresses use numbers that don't exist on the named streets
//
// Realistic, though — deliberately. A contractor learning where the address
// sits on a job card learns nothing from a card reading "FOO BAR 123". The
// data looks like a normal Tuesday.

const today = new Date();

const isoDate = (offsetDays: number) =>
  new Date(today.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const isoTime = (offsetDays: number, hour: number) => {
  const d = new Date(today.getTime() + offsetDays * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

export const DEMO_CLEANER = {
  id: "d0000000-0000-4000-8000-000000000001",
  userId: "d0000000-0000-4000-8000-0000000000a1",
  email: "demo.contractor@example.test",
  firstName: "Nadia",
  lastName: "Okafor",
};

/** The row `resolve_or_link_cleaner_for_user` and `cleaners` both return. */
export const cleanerRow = {
  id: DEMO_CLEANER.id,
  user_id: DEMO_CLEANER.userId,
  first_name: DEMO_CLEANER.firstName,
  last_name: DEMO_CLEANER.lastName,
  email: DEMO_CLEANER.email,
  phone: "+15555550137",
  home_zip: "20814",
  zip_code: "20814",
  city: "Bethesda",
  state: "MD",
  onboarding_complete: true,
  approved: true,
  status: "active",
  stripe_account_id: "demo_acct_contractor",
  payouts_enabled: true,
  phone_verified: true,
  pay_tier: "proven",
  pay_percentage: 41,
  available_for_bookings: true,
  max_bookings_per_week: 12,
  avatar_url: null,
  total_earnings_cents: 1_284_500,
  completed_bookings: 96,
  average_rating: 4.8,
  total_ratings: 71,
  suspended_until: null,
  suspension_reason: null,
  // Onboarding milestones, so the dashboard doesn't lead with a
  // "finish onboarding" checklist the walkthrough never mentions.
  ob_training_accessed: true,
  ob_payouts_setup: true,
  ob_agreement_signed: true,
  ob_google_chat_joined: true,
  ob_supplies_checklist_viewed: true,
  was_linked: false,
  was_auto_promoted: false,
};

// ─── Jobs ───────────────────────────────────────────────────────────────────
//
// Three upcoming and two completed. Enough that the lists look like a real
// week without the clip turning into a scrolling exercise.

const JOB_1 = "e0000000-0000-4000-8000-000000000001";
const JOB_2 = "e0000000-0000-4000-8000-000000000002";
const JOB_3 = "e0000000-0000-4000-8000-000000000003";
const JOB_4 = "e0000000-0000-4000-8000-000000000004";
const JOB_5 = "e0000000-0000-4000-8000-000000000005";

const BOOKING_1 = "b0000000-0000-4000-8000-000000000001";
const BOOKING_2 = "b0000000-0000-4000-8000-000000000002";
const BOOKING_3 = "b0000000-0000-4000-8000-000000000003";
const BOOKING_4 = "b0000000-0000-4000-8000-000000000004";
const BOOKING_5 = "b0000000-0000-4000-8000-000000000005";

export const CHECKLIST_TOKEN = "demo-checklist-token";
export const PHOTO_TOKEN = "demo-photo-token";
export const OFFER_TOKEN = "demo-offer-token";

const jobs = [
  {
    id: JOB_1,
    address: "418 Ridgemont Terrace",
    city: "Bethesda",
    state: "MD",
    zip: "20814",
    service_type: "deep_clean",
    start_datetime: isoTime(1, 13),
    duration_est_hours: 4,
    check_in_time: null,
    status: "assigned",
    notes: "Front door code 4417. Two cats — keep the back bedroom shut.",
  },
  {
    id: JOB_2,
    address: "77 Halloway Court",
    city: "Chevy Chase",
    state: "MD",
    zip: "20815",
    service_type: "standard",
    start_datetime: isoTime(2, 15),
    duration_est_hours: 3,
    check_in_time: null,
    status: "assigned",
    notes: "Park on the street, not the driveway.",
  },
  {
    id: JOB_3,
    address: "1290 Sutterfield Row",
    city: "Silver Spring",
    state: "MD",
    zip: "20910",
    service_type: "move_out",
    start_datetime: isoTime(4, 14),
    duration_est_hours: 5,
    check_in_time: null,
    status: "assigned",
    notes: "Empty unit. Keys from the leasing office.",
  },
  {
    id: JOB_4,
    address: "52 Arden Mill Way",
    city: "Bethesda",
    state: "MD",
    zip: "20816",
    service_type: "standard",
    start_datetime: isoTime(-3, 14),
    duration_est_hours: 3,
    check_in_time: isoTime(-3, 14),
    status: "completed",
    notes: null,
  },
  {
    id: JOB_5,
    address: "903 Kettering Bend",
    city: "Rockville",
    state: "MD",
    zip: "20852",
    service_type: "deep_clean",
    start_datetime: isoTime(-6, 13),
    duration_est_hours: 4,
    check_in_time: isoTime(-6, 13),
    status: "completed",
    notes: null,
  },
];

const jobById = (id: string) => jobs.find((j) => j.id === id)!;

export const jobAssignments = [
  {
    id: "a0000000-0000-4000-8000-000000000001",
    cleaner_id: DEMO_CLEANER.id,
    job_id: JOB_1,
    status: "Accepted",
    estimated_pay_cents: 17_200,
    pay_percentage_snapshot: 41,
    crew_size_snapshot: 1,
    response_token: CHECKLIST_TOKEN,
    assigned_at: isoTime(-1, 9),
    expires_at: null,
    jobs: jobById(JOB_1),
  },
  {
    id: "a0000000-0000-4000-8000-000000000002",
    cleaner_id: DEMO_CLEANER.id,
    job_id: JOB_2,
    status: "Accepted",
    estimated_pay_cents: 11_500,
    pay_percentage_snapshot: 41,
    crew_size_snapshot: 1,
    response_token: "demo-checklist-token-2",
    assigned_at: isoTime(-1, 10),
    expires_at: null,
    jobs: jobById(JOB_2),
  },
  {
    id: "a0000000-0000-4000-8000-000000000003",
    cleaner_id: DEMO_CLEANER.id,
    job_id: JOB_3,
    status: "Accepted",
    estimated_pay_cents: 24_600,
    pay_percentage_snapshot: 41,
    crew_size_snapshot: 2,
    response_token: "demo-checklist-token-3",
    assigned_at: isoTime(-1, 11),
    expires_at: null,
    jobs: jobById(JOB_3),
  },
  // An open offer, for the offers walkthrough.
  {
    id: "a0000000-0000-4000-8000-000000000004",
    cleaner_id: DEMO_CLEANER.id,
    job_id: JOB_3,
    status: "offered",
    estimated_pay_cents: 13_900,
    pay_percentage_snapshot: 41,
    crew_size_snapshot: 1,
    response_token: OFFER_TOKEN,
    assigned_at: isoTime(0, 8),
    expires_at: isoTime(0, 23),
    jobs: jobById(JOB_3),
  },
];

export const bookings = [
  {
    id: BOOKING_1,
    job_id: JOB_1,
    cleaner_id: DEMO_CLEANER.id,
    booking_number: 4821,
    status: "assigned",
    service_date: isoDate(1),
    time_slot: "1:00 PM - 5:00 PM",
    service_type: "deep_clean",
    first_name: "Marguerite",
    last_name: "Hale",
    address: "418 Ridgemont Terrace",
    city: "Bethesda",
    state: "MD",
    zip_code: "20814",
    bedrooms: 4,
    bathrooms: 3,
    sqft: 2850,
    pets: "Two cats",
    access_notes: "Front door code 4417.",
    team_notes: "Client asked about the inside of the oven — it is NOT on this checklist.",
    dispatch_notes: "Confirm arrival by text when you pull up.",
    add_ons: ["Inside fridge"],
    is_reclean: false,
    reclean_scope: null,
    reclean_assessed_value_cents: null,
  },
  {
    id: BOOKING_2,
    job_id: JOB_2,
    cleaner_id: DEMO_CLEANER.id,
    booking_number: 4834,
    status: "assigned",
    service_date: isoDate(2),
    time_slot: "3:00 PM - 6:00 PM",
    service_type: "standard",
    first_name: "Theo",
    last_name: "Brandt",
    address: "77 Halloway Court",
    city: "Chevy Chase",
    state: "MD",
    zip_code: "20815",
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1950,
    pets: null,
    access_notes: "Key under the planter by the side door.",
    team_notes: null,
    dispatch_notes: null,
    add_ons: [],
    is_reclean: false,
    reclean_scope: null,
    reclean_assessed_value_cents: null,
  },
  {
    id: BOOKING_3,
    job_id: JOB_3,
    cleaner_id: DEMO_CLEANER.id,
    booking_number: 4840,
    status: "assigned",
    service_date: isoDate(4),
    time_slot: "2:00 PM - 7:00 PM",
    service_type: "move_out",
    first_name: "Priya",
    last_name: "Raghavan",
    address: "1290 Sutterfield Row",
    city: "Silver Spring",
    state: "MD",
    zip_code: "20910",
    bedrooms: 2,
    bathrooms: 2,
    sqft: 1400,
    pets: null,
    access_notes: "Keys from the leasing office, unit 4.",
    team_notes: null,
    dispatch_notes: null,
    add_ons: ["Inside cabinets", "Inside oven"],
    is_reclean: false,
    reclean_scope: null,
    reclean_assessed_value_cents: null,
  },
  {
    id: BOOKING_4,
    job_id: JOB_4,
    cleaner_id: DEMO_CLEANER.id,
    booking_number: 4788,
    status: "completed",
    service_date: isoDate(-3),
    time_slot: "2:00 PM - 5:00 PM",
    service_type: "standard",
    first_name: "Colin",
    last_name: "Reyes",
    address: "52 Arden Mill Way",
    city: "Bethesda",
    state: "MD",
    zip_code: "20816",
    bedrooms: 3,
    bathrooms: 2,
    sqft: 1780,
    pets: null,
    access_notes: null,
    team_notes: null,
    dispatch_notes: null,
    add_ons: [],
    is_reclean: false,
    reclean_scope: null,
    reclean_assessed_value_cents: null,
  },
  {
    id: BOOKING_5,
    job_id: JOB_5,
    cleaner_id: DEMO_CLEANER.id,
    booking_number: 4759,
    status: "completed",
    service_date: isoDate(-6),
    time_slot: "1:00 PM - 5:00 PM",
    service_type: "deep_clean",
    first_name: "Ada",
    last_name: "Fenwick",
    address: "903 Kettering Bend",
    city: "Rockville",
    state: "MD",
    zip_code: "20852",
    bedrooms: 4,
    bathrooms: 3,
    sqft: 2400,
    pets: "One dog",
    access_notes: null,
    team_notes: null,
    dispatch_notes: null,
    add_ons: [],
    is_reclean: false,
    reclean_scope: null,
    reclean_assessed_value_cents: null,
  },
];

// ─── get-cleaner-portal ─────────────────────────────────────────────────────

function pay(displayCents: number, isActual: boolean, crewSize = 1) {
  return {
    actualCents: isActual ? displayCents : null,
    baseCents: displayCents,
    extrasCents: 0,
    paidCents: isActual ? displayCents : 0,
    pendingCents: isActual ? 0 : displayCents,
    estimateCents: displayCents,
    displayCents,
    isActual,
    status: isActual ? ("paid" as const) : ("pending" as const),
    pctPaid: isActual ? 100 : 0,
    crewSize,
    ratePercent: 41,
  };
}

function portalJob(
  bookingId: string,
  jobId: string,
  customerName: string,
  serviceType: string,
  displayCents: number,
  isActual: boolean,
  crewSize = 1,
) {
  const booking = bookings.find((b) => b.id === bookingId)!;
  return {
    id: bookingId,
    bookingId,
    jobId,
    customerName,
    serviceType,
    homeSizeId: null,
    isReclean: false,
    recleanScope: null,
    recleanAssessedValueCents: null,
    pay: pay(displayCents, isActual, crewSize),
    customerDetails: {
      bedrooms: booking.bedrooms,
      bathrooms: booking.bathrooms,
      sqft: booking.sqft,
      dwellingType: "Single family",
      flooringType: "Hardwood and tile",
      pets: booking.pets,
      addOns: booking.add_ons,
      frequency: "One time",
      accessNotes: booking.access_notes,
    },
    internalDetails: {
      jobValueCents: Math.round(displayCents / 0.41),
      estimateCents: displayCents,
      payoutStatus: isActual ? "paid" : "pending",
      payoutNote: null,
      dispatchNotes: booking.dispatch_notes,
      teamNotes: booking.team_notes,
      issuesFlag: false,
      issuesNotes: null,
      crewSize,
      ratePercent: 41,
    },
  };
}

export const portalPayload = {
  ok: true,
  cleaner: {
    id: DEMO_CLEANER.id,
    firstName: DEMO_CLEANER.firstName,
    scores: { novara: 91, quality: 94, overall: 92 },
    qcSummary: null,
  },
  summary: {
    lifetimePaidCents: 1_284_500,
    pendingCents: 53_300,
    paidJobs: 96,
    lifetimeTipsCents: 41_200,
  },
  jobs: [
    portalJob(BOOKING_1, JOB_1, "Marguerite Hale", "deep_clean", 17_200, false),
    portalJob(BOOKING_2, JOB_2, "Theo Brandt", "standard", 11_500, false),
    portalJob(BOOKING_3, JOB_3, "Priya Raghavan", "move_out", 24_600, false, 2),
    portalJob(BOOKING_4, JOB_4, "Colin Reyes", "standard", 11_200, true),
    portalJob(BOOKING_5, JOB_5, "Ada Fenwick", "deep_clean", 16_800, true),
  ],
  coverageOffers: [],
  offers: [
    {
      token: OFFER_TOKEN,
      serviceType: "standard",
      serviceDate: isoDate(3),
      timeSlot: "9:00 AM - 12:00 PM",
      city: "Kensington",
      state: "MD",
      estimatedPayCents: 13_900,
      isReclean: false,
      recleanScope: null,
    },
  ],
  tips: [
    {
      bookingId: BOOKING_4,
      bookingRef: "NVC-4788",
      amountCents: 2_000,
      totalTipCents: 2_000,
      crewSize: 1,
      allocation: "directed" as const,
      receivedAt: isoTime(-3, 19),
    },
    {
      bookingId: BOOKING_5,
      bookingRef: "NVC-4759",
      amountCents: 1_500,
      totalTipCents: 3_000,
      crewSize: 2,
      allocation: "split" as const,
      receivedAt: isoTime(-6, 18),
    },
  ],
};

/** The lookup page's own job rows (a flatter shape than the dashboard's). */
export const lookupJobs = [
  {
    id: BOOKING_1,
    bookingId: BOOKING_1,
    jobId: JOB_1,
    bookingNumber: 4821,
    status: "assigned",
    serviceDate: isoDate(1),
    timeSlot: "1:00 PM - 5:00 PM",
    serviceType: "deep_clean",
    homeSizeId: null,
    customerName: "Marguerite Hale",
    address: "418 Ridgemont Terrace",
    city: "Bethesda",
    state: "MD",
    zip: "20814",
    checkInTime: null,
    qcToken: null,
    tipCents: 0,
    photoUploadToken: PHOTO_TOKEN,
    photoViewToken: null,
    beforePhotos: [],
    afterPhotos: [],
    pay: pay(17_200, false),
    crew: [],
    commercial: null,
    customerDetails: portalPayload.jobs[0].customerDetails,
    internalDetails: portalPayload.jobs[0].internalDetails,
  },
  {
    id: BOOKING_4,
    bookingId: BOOKING_4,
    jobId: JOB_4,
    bookingNumber: 4788,
    status: "completed",
    serviceDate: isoDate(-3),
    timeSlot: "2:00 PM - 5:00 PM",
    serviceType: "standard",
    homeSizeId: null,
    customerName: "Colin Reyes",
    address: "52 Arden Mill Way",
    city: "Bethesda",
    state: "MD",
    zip: "20816",
    checkInTime: isoTime(-3, 14),
    qcToken: null,
    tipCents: 2_000,
    photoUploadToken: null,
    photoViewToken: null,
    beforePhotos: [],
    afterPhotos: [],
    pay: pay(11_200, true),
    crew: [],
    commercial: null,
    customerDetails: portalPayload.jobs[3].customerDetails,
    internalDetails: portalPayload.jobs[3].internalDetails,
  },
];

// ─── cleaner-job-checklist ──────────────────────────────────────────────────
//
// A Deep Clean partway through: the kitchen finished, the primary bath in
// progress. Mid-job is the right state to record — an empty checklist doesn't
// show what progress looks like, and a finished one doesn't either.

const CHECKLIST_SECTIONS = [
  {
    title: "Kitchen",
    items: [
      "Counters cleared, wiped, and items replaced",
      "Sink and faucet scrubbed and polished",
      "Appliance exteriors wiped (fridge, oven, dishwasher, microwave)",
      "Stovetop degreased, under burners included",
      "Cabinet fronts hand-wiped",
      "Floor swept and mopped, edges included",
      "Trash emptied and liner replaced",
    ],
    photoRequired: true,
  },
  {
    title: "Primary bathroom",
    items: [
      "Soap scum pre-treated at the start of the visit",
      "Shower and tub scrubbed, including door glass",
      "Toilet cleaned lid to base",
      "Vanity, sink, and fixtures polished",
      "Mirror wiped streak-free",
      "Floor mopped, behind the toilet included",
    ],
    photoRequired: true,
  },
  {
    title: "Bedrooms and living areas",
    items: [
      "All surfaces dusted top to bottom",
      "Baseboards and door frames wiped",
      "Beds made as found",
      "Floors vacuumed, under furniture edges included",
      "Interior door glass wiped",
    ],
    photoRequired: false,
  },
];

function checklistItems() {
  const items: Record<string, { done: boolean; at: string; by: string }> = {};
  // Kitchen complete, primary bath three of six — the shape of a real
  // mid-visit checklist rather than a suspiciously tidy one.
  for (let i = 0; i < CHECKLIST_SECTIONS[0].items.length; i += 1) {
    items[`0:${i}`] = { done: true, at: isoTime(0, 14), by: "You" };
  }
  for (let i = 0; i < 3; i += 1) {
    items[`1:${i}`] = { done: true, at: isoTime(0, 15), by: "You" };
  }
  return items;
}

const totalItems = CHECKLIST_SECTIONS.reduce((sum, s) => sum + s.items.length, 0);
const completedItems = CHECKLIST_SECTIONS[0].items.length + 3;

export const checklistState = {
  ok: true,
  canWrite: true,
  is_crew_lead: true,
  crew_size: 1,
  zone_completion: [],
  job: {
    id: JOB_1,
    service_type: "deep_clean",
    address: "418 Ridgemont Terrace",
    city: "Bethesda",
    state: "MD",
    zip: "20814",
    start_datetime: isoTime(0, 13),
    duration_est_hours: 4,
    status: "in_progress",
  },
  booking: {
    ref: "NVC-4821",
    first_name: "Marguerite",
    service_date: isoDate(0),
    time_slot: "1:00 PM - 5:00 PM",
    access_notes: "Front door code 4417.",
    team_notes: "Client asked about the inside of the oven — it is NOT on this checklist.",
    dispatch_notes: "Confirm arrival by text when you pull up.",
    add_ons: ["Inside fridge"],
    focused_areas: [],
  },
  cleaner: { id: DEMO_CLEANER.id, first_name: DEMO_CLEANER.firstName },
  checklist: {
    key: "deep_clean",
    name: "Deep Clean checklist",
    blurb: "Every line below is included in this job. Nothing off this list is.",
    sections: CHECKLIST_SECTIONS,
    items: checklistItems(),
    total_items: totalItems,
    completed_items: completedItems,
    progress_pct: Math.round((completedItems / totalItems) * 100),
    completed_at: null,
    section_meta: {
      "0": { before: ["demo-before-kitchen.jpg"], after: ["demo-after-kitchen.jpg"] },
      "1": { before: ["demo-before-bath.jpg"], after: [] },
    },
  },
  focused: { enabled: false },
  zones: { enabled: false },
  addons: {
    enabled: true,
    sharePct: 41,
    teamSize: 1,
    catalog: [
      { id: "inside_fridge", label: "Inside fridge", price: 45, note: "", included: true },
      { id: "inside_oven", label: "Inside oven", price: 55, note: "", included: false },
      { id: "interior_windows", label: "Interior windows", price: 65, note: "", included: false },
    ],
    requests: [],
  },
  findings: [],
  finding_areas: [],
};

// ─── get-cleaner-photo-form ─────────────────────────────────────────────────

export const photoForm = {
  ok: true,
  bookingId: BOOKING_1,
  bookingNumber: 4821,
  serviceDate: isoDate(0),
  timeSlot: "1:00 PM - 5:00 PM",
  serviceType: "deep_clean",
  customerName: "Marguerite Hale",
  address: "418 Ridgemont Terrace",
  city: "Bethesda",
  state: "MD",
  beforeCount: 0,
  afterCount: 0,
  beforePhotos: [],
  afterPhotos: [],
  alreadySubmitted: false,
};

// ─── get-job-offer ──────────────────────────────────────────────────────────

export const jobOffer = {
  ok: true,
  status: "offered",
  token: OFFER_TOKEN,
  assignmentId: "a0000000-0000-4000-8000-000000000004",
  role: "cleaner",
  serviceType: "standard",
  serviceDate: isoDate(3),
  timeSlot: "9:00 AM - 12:00 PM",
  address: "336 Windmere Crossing",
  city: "Kensington",
  state: "MD",
  zip: "20895",
  bedrooms: 3,
  bathrooms: 2,
  sqft: 1850,
  distanceMiles: 6.4,
  estimatedPayCents: 13_900,
  payPercentageSnapshot: 41,
  crewSizeSnapshot: 1,
  durationEstHours: 3,
  expiresAt: isoTime(0, 23),
  acceptedAt: null,
  declinedAt: null,
  reliabilityNeutral: false,
  cleaner: {
    id: DEMO_CLEANER.id,
    firstName: DEMO_CLEANER.firstName,
    payTier: "proven",
    payPercentage: 41,
  },
};

/** The open offers the /cleaner/job-offers list reads from job_assignments. */
export const offerRows = jobAssignments
  .filter((a) => a.status === "offered")
  .map((a) => ({
    id: a.id,
    status: a.status,
    response_token: a.response_token,
    estimated_pay_cents: a.estimated_pay_cents,
    pay_percentage_snapshot: a.pay_percentage_snapshot,
    crew_size_snapshot: a.crew_size_snapshot,
    expires_at: a.expires_at,
    assigned_at: a.assigned_at,
    cleaner_id: a.cleaner_id,
    jobs: {
      ...jobById(JOB_3),
      address: "336 Windmere Crossing",
      city: "Kensington",
      zip: "20895",
      service_type: "standard",
      start_datetime: isoTime(3, 13),
      duration_est_hours: 3,
    },
  }));

export const DEMO_DATES = { isoDate, isoTime };
