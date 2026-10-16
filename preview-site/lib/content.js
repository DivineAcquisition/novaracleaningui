export const BOOK_URL = "https://try.novaracleaning.com/";
export const SIGN_IN_URL = "https://app.novaracleaning.com/";
export const CLEANER_APPLY_URL = "https://novaracleaning.fillout.com/fieldcleaner";
export const CHECKLIST_URL = "https://try.novaracleaning.com/checklist";
export const PHONE_DISPLAY = "(844) 735-2070";
export const PHONE_TEL = "+18447352070";
export const SUPPORT_EMAIL = "support@novaracleaning.com";

export const nav = [
  { href: "/", label: "Home" },
  { href: "/#about", label: "About" },
  { href: "/services", label: "Services" },
  { href: "/contact", label: "Contact" },
];

export const footer = {
  main: [
    { href: "/", label: "Home" },
    { href: "/#about", label: "About Us" },
    { href: CLEANER_APPLY_URL, label: "Become A Cleaner", external: true },
    { href: BOOK_URL, label: "Book Services", external: true },
    { href: "/contact", label: "Contact Us" },
    { href: "/membership", label: "Membership" },
    { href: "/careers", label: "Careers" },
  ],
  legal: [
    { href: "/legal/terms", label: "Terms Of Service" },
    { href: "/legal/privacy", label: "Privacy Policy" },
    { href: "/legal/disclaimer", label: "Disclaimers" },
    { href: "/legal/cancellation-policy", label: "Cancellation Policy" },
    { href: "/legal/refund-policy", label: "Refund Policy" },
    { href: "/legal/membership-policy", label: "Membership Policy" },
  ],
  services: [
    { href: "/services/deep-clean", label: "Deep Clean" },
    { href: "/services/standard-cleaning", label: "Standard Clean" },
    { href: "/services/move-in-out", label: "Move In & Out Clean" },
    { href: "/services/office-cleaning", label: "Office Cleaning" },
    { href: "/services/commercial", label: "Commercial" },
    { href: CHECKLIST_URL, label: "Checklist", external: true },
  ],
};

export const serviceCards = [
  {
    slug: "commercial",
    title: "Commercial Partnership",
    blurb: "For larger or mixed-use facilities — retail, medical, gyms, multi-tenant, industrial-light.",
  },
  {
    slug: "office-cleaning",
    title: "Office Cleaning",
    blurb: "For professional offices, suites, and workspaces, recurring or one-time.",
  },
  {
    slug: "recurring-service",
    title: "Recurring Service",
    blurb: "Consistent, hassle-free cleaning on the schedule that fits your life weekly, biweekly, or monthly.",
  },
  {
    slug: "deep-clean",
    title: "Deep Cleaning",
    blurb: "Comprehensive home detailing, advanced cleaning, and tailored for every home.",
  },
  {
    slug: "standard-cleaning",
    title: "Standard Cleaning",
    blurb: "Reliable routine maintenance, thorough surface care, and ideal for regular upkeep.",
  },
  {
    slug: "move-in-out",
    title: "Moving Cleaning",
    blurb: "Complete property reset, extensive interior detailing, and perfect for transitions.",
  },
];

const kitchenStandard = [
  "Dust and spot-clean cabinet fronts",
  "Clean countertops",
  "Clean sink and polish faucet",
  "Dust small appliances and items on countertops",
  "Clean microwave (inside and out)",
  "Clean and polish oven and refrigerator exterior",
  "Clean and polish stove top and vent hood",
  "Vacuum and mop kitchen floor",
  "Remove trash, replace bag, wipe exterior",
];

const bathStandard = [
  "Clean mirrors (streak-free)",
  "Dust light fixtures",
  "Spot-clean cabinet fronts",
  "Scrub shower and tub",
  "Clean counters, sinks, and polish fixtures",
  "Disinfect toilet and surrounding area",
  "Vacuum bathroom rugs",
  "Remove trash, replace bag, wipe exterior",
  "Clean and disinfect bathroom floor",
];

const roomsStandard = [
  "Remove cobwebs and dust ceiling fans",
  "Dust reachable light fixtures",
  "Dust wall art and A/C vents",
  "Disinfect light switches and door knobs",
  "Dust and spot-clean doors and door frames",
  "Dust window sills and ledges",
  "Dust baseboards and blinds",
  "Dust TVs, electronics, knick-knacks, picture frames, lamps",
  "Dust all furniture (polish as needed)",
  "Dust banisters and handrails",
  "Vacuum all floors and stairs; mop hard surfaces",
  "Vacuum upholstered furniture (where possible)",
  "Change linens and/or make beds",
  "Clean front and back door glass",
];

export const services = {
  "deep-clean": {
    title: "Deep Cleaning",
    eyebrow: "Comprehensive home detailing, advanced cleaning, and tailored for every home.",
    summaryTitle: "Deep Clean",
    summary:
      "Our most thorough single visit — the reset your home deserves. In addition to everything in a Standard Clean, we hand-wipe the details that usually get missed: baseboards, door frames, light fixtures, ceiling fan blades, window sills, and under stove burners. We hand-polish wood furniture and vacuum beneath furniture where possible. Recommended as a first clean before recurring service, or as a seasonal refresh once or twice a year.",
    meta: "Estimated time: 4–6 hours · Best for: first-time service or seasonal reset · One-time, or 1–2x/year",
    groups: [
      {
        title: "Kitchen",
        items: [
          "Hand-wipe all cabinet exteriors",
          "Clean countertops",
          "Wipe backsplash",
          "Clean sink and polish faucets",
          "Hand-wipe small appliances and items on countertops",
          "Clean microwave (inside and out)",
          "Clean and polish oven and refrigerator exterior",
          "Clean and polish stove top and vent hood",
          "Detail-clean under electric range burners",
          "Vacuum and mop kitchen floor",
          "Remove trash, replace bag, wipe exterior",
        ],
      },
      {
        title: "Bathrooms",
        items: [
          "Clean mirrors (streak-free)",
          "Wipe all reachable light fixtures",
          "Wipe cabinet fronts",
          "Scrub shower and tub",
          "Clean counters, sinks, and polish fixtures",
          "Disinfect toilet and surrounding area",
          "Vacuum bathroom rugs",
          "Remove trash, replace bags, wipe exterior",
          "Clean and disinfect bathroom floor",
        ],
      },
      {
        title: "All Rooms",
        items: [
          "Remove cobwebs",
          "Wipe all reachable light fixtures and ceiling fan blades",
          "Dust wall art and A/C vents",
          "Disinfect light switches and door knobs",
          "Hand-wipe door frames and doors",
          "Hand-wipe window sills and window ledges",
          "Dust baseboards and blinds",
          "Dust TVs, electronics, book tops, knick-knacks, lamps",
          "Hand-polish all wood furniture",
          "Dust banisters and handrails",
          "Vacuum floors and mop hard surface floors",
          "Vacuum under all furniture (where possible)",
          "Vacuum carpet edges with attachment",
          "Vacuum upholstered furniture and crevices",
          "Change linens and/or make beds",
          "Clean front and back door glass",
        ],
      },
    ],
  },
  "standard-cleaning": {
    title: "Standard Cleaning",
    eyebrow: "Reliable routine maintenance, thorough surface care, and ideal for regular upkeep.",
    summaryTitle: "Standard Clean",
    summary:
      "A thorough top-to-bottom refresh for homes that are already well-maintained. We dust and wipe surfaces throughout, clean and sanitize kitchens and bathrooms, vacuum and mop all floors, and tidy every room so your home feels fresh and cared for. Ideal as a one-time clean when your space just needs a reset. If it's been a while since your last professional cleaning, we recommend starting with a Deep Clean.",
    meta: "Estimated time: 2–3 hours · Best for: already-maintained homes · One-time service",
    groups: [
      { title: "Kitchen", items: kitchenStandard },
      { title: "Bathrooms", items: bathStandard },
      { title: "All Rooms", items: roomsStandard },
    ],
  },
  "move-in-out": {
    title: "Moving Cleaning",
    eyebrow: "Complete property reset, extensive interior detailing, and perfect for transitions.",
    summaryTitle: "Move In / Move Out Clean",
    summary:
      "A complete clean for empty homes, designed for moving day. Because the space is cleared out, we reach everything a regular clean can't — inside all cabinets, drawers, and the pantry, plus built-in shelving and bookcases. Includes everything in a Deep Clean and gets the home ready for the next chapter, whether you're settling in or handing back the keys. Perfect for end-of-lease, pre-sale, or move-in prep.",
    meta: "Estimated time: 5–7 hours · Best for: moving in/out, end-of-lease, pre-sale · One-time service",
    groups: [
      {
        title: "Kitchen",
        items: [
          "Hand-wipe all cabinet exteriors",
          "Clean and wipe down pantry",
          "Vacuum out and wipe inside all cabinets and drawers",
          "Clean countertops",
          "Wipe backsplash",
          "Clean sink and polish faucets",
          "Clean microwave (inside and out)",
          "Clean and polish oven and refrigerator exterior",
          "Clean and polish stove top and vent hood",
          "Detail-clean under electric range burners",
          "Vacuum and mop kitchen floor",
        ],
      },
      {
        title: "Bathrooms",
        items: [
          "Clean mirrors (streak-free)",
          "Wipe all reachable light fixtures",
          "Wipe cabinet fronts",
          "Wipe out inside cabinets and drawers",
          "Scrub shower and tub",
          "Clean counters, sinks, and polish fixtures",
          "Disinfect toilet and surrounding area",
          "Clean and disinfect bathroom floor",
        ],
      },
      {
        title: "All Rooms",
        items: [
          "Remove cobwebs",
          "Wipe all reachable light fixtures and ceiling fan blades",
          "Dust A/C vents",
          "Wipe inside and out of any built-in cabinets or bookcases",
          "Disinfect light switches and door knobs",
          "Hand-wipe door frames and doors",
          "Hand-wipe window sills and ledges",
          "Dust baseboards and blinds",
          "Dust banisters and handrails",
          "Vacuum floors and mop hard surface floors",
          "Vacuum carpet edges with attachment",
          "Clean front and back door glass",
        ],
      },
    ],
  },
  "recurring-service": {
    title: "Recurring Service",
    eyebrow: "Consistent, hassle-free cleaning on the schedule that fits your life — weekly, biweekly, or monthly.",
    summaryTitle: "Recurring Clean",
    summary:
      "Each visit keeps your home fresh with a full clean of every room, every time. Recurring clients enjoy preferred pricing and priority scheduling. We recommend starting with a Deep Clean to set the baseline, then letting us maintain it from there.",
    meta: "Estimated time: 1.5–2.5 hours per visit (after initial Deep Clean) · Best for: ongoing upkeep · Weekly, biweekly, or monthly",
    groups: [
      { title: "Kitchen", items: kitchenStandard },
      { title: "Bathrooms", items: bathStandard },
      { title: "All Rooms", items: roomsStandard },
    ],
  },
  "office-cleaning": {
    title: "Office Cleaning",
    eyebrow: "For professional offices, suites, and workspaces — recurring or one-time.",
    summaryTitle: "Office Cleaning Checklist",
    summary: "For professional offices, suites, and workspaces — recurring or one-time.",
    meta: null,
    groups: [
      {
        title: "Reception & Common Areas",
        items: [
          "Dust all surfaces — desks, ledges, sills, and décor wiped down",
          "Glass and entry doors — smudges and fingerprints removed from glass",
          "Seating areas — chairs, couches, and tables wiped and arranged",
          "Floors vacuumed — carpets and rugs throughout the space",
          "Hard floors mopped — entryways and walkways sanitized",
          "Trash emptied — bins emptied, liners replaced, cans wiped",
        ],
      },
      {
        title: "Workstations & Desks",
        items: [
          "Desk surfaces wiped — cleared areas dusted and disinfected",
          "Electronics dusted — monitors, keyboards, phones lightly dusted (no liquids)",
          "Touchpoints disinfected — door handles, light switches, shared equipment",
          "Chairs straightened — wheels and bases wiped, seats tidied",
        ],
      },
      {
        title: "Kitchen / Break Room",
        items: [
          "Counters and sink — wiped, scrubbed, and sanitized",
          "Appliance exteriors — microwave (inside and out), fridge front, coffee station",
          "Tables and chairs — wiped down and arranged",
          "Trash and recycling — emptied, liners replaced",
          "Floors — swept and mopped",
        ],
      },
      {
        title: "Restrooms",
        items: [
          "Toilets and urinals — scrubbed, disinfected inside and out",
          "Sinks and counters — cleaned and polished",
          "Mirrors — wiped streak-free",
          "Floors — mopped and sanitized",
          "Restock — soap, paper towels, toilet paper refilled",
          "Trash emptied — bins emptied, liners replaced",
        ],
      },
      {
        title: "Conference & Meeting Rooms",
        items: [
          "Tables wiped — surfaces cleaned and disinfected",
          "Chairs arranged — wiped and set neatly",
          "Glass and whiteboards — glass surfaces cleaned, boards wiped if requested",
          "Floors — vacuumed or mopped",
        ],
      },
      {
        title: "Finishing Touches",
        items: [
          "High-touch sweep — all door handles, switches, rails disinfected",
          "Final walkthrough — spaces tidied, lights and equipment left as instructed",
        ],
      },
    ],
  },
  commercial: {
    title: "Commercial Partnership",
    eyebrow: "For larger or mixed-use facilities — retail, medical, gyms, multi-tenant, industrial-light.",
    summaryTitle: "Commercial Cleaning Checklist",
    summary: "For larger or mixed-use facilities — retail, medical, gyms, multi-tenant, industrial-light.",
    meta: null,
    groups: [
      {
        title: "Entrances & Lobbies",
        items: [
          "Glass doors and windows — entry glass cleaned inside and out (reachable height)",
          "Floors — high-traffic entry floors swept, mopped, or buffed",
          "Mats and rugs — vacuumed or shaken out",
          "Trash and exterior bins — emptied near entrances, liners replaced",
          "Touchpoints — handles, push bars, elevator buttons disinfected",
        ],
      },
      {
        title: "Open Floor / Work Areas",
        items: [
          "Floors — vacuum carpet, mop hard floors across the full footprint",
          "Surfaces — counters, shelving, ledges dusted and wiped",
          "Walls and doors — spot-cleaned for marks and smudges",
          "Trash stations — all bins emptied, liners replaced, cans wiped",
        ],
      },
      {
        title: "Restrooms (Multi-Stall)",
        items: [
          "All fixtures — toilets, urinals, sinks scrubbed and disinfected",
          "Partitions and walls — wiped and sanitized",
          "Mirrors and metal — cleaned and polished",
          "Floors — mopped with disinfectant, corners and grout addressed",
          "Full restock — soap, paper, seat covers, sanitizer",
          "Trash — all receptacles emptied and relined",
        ],
      },
      {
        title: "Break Rooms / Kitchens",
        items: [
          "Counters and sinks — sanitized",
          "Appliances — microwave, fridge front, vending and coffee areas wiped",
          "Tables and seating — cleaned and arranged",
          "Floors — swept and mopped",
          "Trash and recycling — emptied and relined",
        ],
      },
      {
        title: "Hallways, Stairs & Common Areas",
        items: [
          "Floors — vacuumed or mopped end to end",
          "Stairwells — steps swept, railings wiped and disinfected",
          "Elevators — floors cleaned, walls and panels wiped",
          "Glass and fixtures — interior glass and signage wiped",
        ],
      },
      {
        title: "High-Touch & Sanitation",
        items: [
          "Disinfect all touchpoints — handles, switches, rails, shared equipment, buttons",
          "Drinking fountains — cleaned and sanitized",
          "Common-use surfaces — counters, kiosks, shared screens wiped",
        ],
      },
      {
        title: "Finishing & Verification",
        items: [
          "Final walkthrough — all zones checked against scope",
          "Photo documentation — before and after where required",
          "Secure and set — lights, doors, alarms handled per client instructions",
        ],
      },
    ],
  },
};

export const quoteServices = [
  "Deep Cleaning",
  "Standard Cleaning",
  "Move In & Out",
  "Recurring Service",
  "Office Cleaning",
  "Commercial Partnership",
];

export const faqs = [
  {
    q: "What does a “One-Time Cleaning” include?",
    a: "Our one-time cleaning packages (Standard, Deep, and Move-In/Out) cover detailed cleaning of key living areas, bathrooms, kitchen, and bedrooms. Each package follows a strict cleaning checklist that ensures quality and consistency. Tasks outside the checklist (like carpet shampooing, wall washing, or heavy appliance moves) are considered add-ons and must be quoted separately.",
  },
  {
    q: "Can I get a refund if I change my mind?",
    a: "Once a clean has been performed, the sale is final. Cleaning is labor that cannot be returned. The usual remedy for a real quality issue is a complimentary re-clean, not a refund. Change of mind, buyer’s remorse, and cancellation or no-show fees are not refundable. Full refunds are limited to cases such as a verified no-show or a duplicate charge. See the Refund Policy for the exact rules.",
  },
  {
    q: "What if I’m not happy with the cleaning?",
    a: "If anything is missed, we come back for a free re-clean. Report the specific checklist items in writing within 24 hours, with photos, and leave the area undisturbed so we can verify it. Membership plans include a 48-hour reclean guarantee. A refund is not the first step — the re-clean is.",
  },
  {
    q: "Do I need to be home during the cleaning?",
    a: "You do not have to be home if we can get in. Leave a working gate, door, or lockbox code, parking notes, and pet instructions before the appointment. If the access details are wrong and we cannot enter, that visit is treated as a no-show and the service fee is charged.",
  },
  {
    q: "What if I need to cancel or reschedule?",
    a: "Cancel or reschedule at least 24 hours before the appointment by emailing cancellations@novaracleaning.com or through your customer portal. Inside 24 hours, the cancellation fee is $25. A request counts only after NovaraCleaning confirms it.",
  },
];

export const steps = [
  {
    title: "Enter Zip Code",
    body: "Enter your zip code to see trusted, background-checked cleaners in your area.",
    icon: "pin",
  },
  {
    title: "Choose Your Time & Price",
    body: "Pick a service, see the price, and choose a time that works.",
    icon: "clock",
  },
  {
    title: "Book Instantly & Relax",
    body: "Pay a small deposit to secure your cleaning — we’ll handle the rest.",
    icon: "calendar",
  },
];

export const values = [
  {
    title: "Honest Transparency",
    body: "We believe Maryland families deserve clarity. That means upfront pricing, no hidden fees, and straightforward communication at every step — from booking to payment to follow-up.",
    icon: "hands",
  },
  {
    title: "Care with Consistency",
    body: "A clean home isn’t just about today, it’s about peace of mind week after week. We focus on reliable recurring service, background-checked cleaners, and eco-friendly supplies that protect both families and their homes.",
    icon: "clock",
  },
  {
    title: "Local Roots, Lasting Trust",
    body: "We’re Marylanders serving Marylanders. Our goal is to make quality cleaning accessible without cutting corners — delivering work that earns repeat trust and referrals across the neighborhoods we serve.",
    icon: "people",
  },
];

export const comparisons = [
  {
    before: "/images/porch-before.jpg",
    after: "/images/porch-after.jpg",
    label: "Screened porch",
  },
  {
    before: "/images/room-before.jpg",
    after: "/images/room-after.jpg",
    label: "Living area",
  },
  {
    before: "/images/tile-before.jpg",
    after: "/images/tile-after.jpg",
    label: "Tile floor",
  },
];

export const plans = [
  {
    name: "Novara Monthly",
    price: "$189",
    audience: "Ideal for busy individuals or smaller households who want maintenance-level cleanings without overpaying.",
    features: [
      "Includes 1 cleaning credit per month (up to 2 hours)",
      "48-hour reclean guarantee",
      "Priority support & flexible reschedules",
      "20% off any extra hours of cleans",
    ],
    featured: false,
  },
  {
    name: "Novara Bi-Weekly",
    price: "$289",
    audience: "Designed for families or professionals who want a clean, refreshed home every other week.",
    features: [
      "Includes 2 cleaning credits per month (up to 3 hours each)",
      "Dedicated cleaner match",
      "25% off deep cleans & add-ons",
      "Best cleaning guaranteed satisfaction",
    ],
    featured: false,
  },
  {
    name: "Novara Weekly",
    price: "$389",
    audience: "For clients who want premium, hands-off upkeep and total peace of mind. Never worry about cleaning again.",
    features: [
      "Includes 4 cleaning credits per month (up to 3 hours each)",
      "Dedicated cleaner & preferred time",
      "Every 6 months, get a free deep clean",
      "30% off any extra hours of cleaning",
    ],
    featured: true,
  },
];

export const jobs = [
  {
    title: "Field Cleaner",
    body: "Execute scheduled home cleanings using checklists; punctual, reliable, customer-friendly service.",
    place: "MD, US",
    mode: "In-Person",
    pay: "$2,000–$3,000 /month",
    href: CLEANER_APPLY_URL,
    external: true,
  },
  {
    title: "Specialized Contractor",
    body: "Handle advanced, high-standard cleans; bring expertise/equipment; meet strict timelines.",
    place: "MD, US",
    mode: "In-Person",
    pay: "$3,200–$5,500+ /month",
    href: "/careers/specialized-contractor",
    external: false,
  },
];

export const legalPages = {
  terms: { title: "Terms Of Service", file: "terms.txt" },
  privacy: { title: "Privacy Policy", file: "privacy.txt" },
  disclaimer: { title: "Disclaimer", file: "disclaimer.txt" },
  "cancellation-policy": { title: "Cancellation Policy", file: "cancellation-policy.txt" },
  "refund-policy": { title: "Refund Policy", file: "refund-policy.txt" },
  "membership-policy": { title: "Membership Policy", file: "membership-policy.txt" },
};

export const places = [
  "Bethesda",
  "Silver Spring",
  "Rockville",
  "Arlington",
  "Alexandria",
  "Washington, DC",
  "College Park",
  "Chevy Chase",
  "Potomac",
  "Hyattsville",
];

export const areas = [
  { name: "Maryland", query: "Maryland" },
  { name: "Virginia", query: "Virginia" },
  { name: "Washington, DC", query: "Washington DC" },
];
