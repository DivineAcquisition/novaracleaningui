/**
 * Landing page copy. One source for every sentence on try.novaracleaning.com.
 * Layout code reads this file and does not own sentences.
 *
 * Rules: short, plain sentences. Every claim is something the business does
 * today. Mockups that use sample data say so. Numbers that depend on live
 * data come from getLandingData(), not from here.
 */

export const SITE = {
  title: "House cleaning with the price up front · Novara Cleaning",
  description:
    "House cleaning across Maryland, DC and Northern Virginia. Your exact price before anyone walks in, a written checklist on every visit, and a free re-clean if something is missed.",
} as const;

export const NAV = {
  links: [
    { href: "#how", label: "How it works" },
    { href: "#nova", label: "Nova" },
    { href: "#prices", label: "Prices" },
    { href: "#hosts", label: "Airbnb hosts" },
    { href: "#faq", label: "FAQ" },
  ],
  signIn: "Sign in",
  cta: "Get my price",
} as const;

export const HERO = {
  eyebrow: "Novara Cleaning",
  headline: "Know the price before anyone walks in.",
  supporting:
    "House cleaning across Maryland, DC and Northern Virginia. Enter your ZIP and see what your clean costs. Then pick a time.",
  zipLabel: "Your ZIP code",
  zipPlaceholder: "e.g. 20814",
  primaryCta: "Get my price",
  secondaryCta: "Hear Nova take a call",
  trust: "No card to see a price. A written checklist on every visit. Missed something? We come back within 48 hours.",
  offer: "New customers: 15% off a standard clean, 25% off a deep clean.",
  exampleLabel: "Example with sample data",
} as const;

/** The hero product frame. Sample data, labelled as such. */
export const QUOTE_STUDIO = {
  label: "Quote · Bethesda, MD 20814",
  title: "Deep clean, 3 bed · 2 bath",
  steps: ["Reading your ZIP", "Sizing your home", "Adding extras", "Checking open times"],
  inputs: [
    { label: "ZIP", value: "20814" },
    { label: "Home", value: "1,000 – 1,500 sq ft" },
    { label: "Condition", value: "Standard" },
    { label: "Extras", value: "Inside oven" },
  ],
  slots: ["Thu 9:00 AM", "Thu 1:00 PM", "Fri 9:00 AM"],
  footnote: "Exact price. Shown before you pay.",
} as const;

/** The strip under the hero: requests flow into Nova, and Nova hands back a booked visit. */
export const AGENT_FLOW = {
  sources: [
    { key: "call", label: "Phone call" },
    { key: "text", label: "Text message" },
    { key: "web", label: "This website" },
    { key: "host", label: "Host portal" },
    { key: "member", label: "Membership schedule" },
  ],
  agent: "Nova",
  agentRole: "Booking assistant",
  statuses: [
    "Answering a call",
    "Looking up the address",
    "Pricing the home",
    "Texting the checklist",
    "Booking Thursday 9:00 AM",
  ],
  output: {
    title: "Visit booked",
    meta: "Thu 9:00 AM · Deep clean · Confirmation texted",
    state: "Cleaner assigned",
  },
  caption: "Sample run. Every booking goes through the same steps, day or night.",
} as const;

export const PROBLEM = {
  id: "problem",
  headline: "Most cleaning quotes start with a guess.",
  opening: "You call, leave a message, and wait. When someone calls back, the price is “it depends” until they see the house.",
  scattered:
    "Then the visit happens and nobody wrote down what was supposed to be done. When something is missed, it turns into your word against theirs.",
  pains: [
    "You call three companies and one calls back.",
    "The price changes after someone walks through.",
    "Nobody tells you what is actually included.",
    "If something is missed, you have to argue about it.",
  ],
  scene: {
    tabs: ["Voicemail (3)", "Quote: TBD", "Callback Tuesday?", "Notes"],
    activeTab: 1,
    note: "“Should be around $150–$300, depends what we see when we get there.”",
    flags: ["No price", "No checklist", "No callback time"],
    stamp: "Guess",
  },
  bridge: { text: "Novara starts with the price instead.", link: "See how it works", href: "#how" },
} as const;

export const STANDARD = {
  id: "standard",
  eyebrow: "How we work",
  headline: "Written down before we walk in.",
  paragraphs: [
    "A clean is easy to promise and hard to check. So we write it down first: the price, the time, and every task on the list.",
    "Your cleaner works from that list room by room. If something on it was missed, you tell us within 48 hours and we come back to do it. No forms.",
  ],
  tenets: [
    { id: "price", title: "Price before the visit", body: "You see the exact total before you pay. It does not change at the door." },
    { id: "list", title: "The checklist is the promise", body: "Every service has a written list. That list is what you are paying for." },
    { id: "honest", title: "Say when we can't", body: "If we don't serve your ZIP yet, we tell you and add you to the waitlist." },
    { id: "people", title: "People do the cleaning", body: "Software handles the booking. A person cleans your home and answers for it." },
  ],
  documentLabel: "Standard clean · the list your cleaner works from",
  documentLink: { href: "/checklist/standard-clean", label: "Read the full checklist" },
} as const;

/** How it works, played as a run. Each step reports what it did. Sample values. */
export const HOW = {
  id: "how",
  headline: "Booked in minutes. Checked after.",
  lead: "Every booking goes through the same five steps. Here is one, with sample details.",
  labels: { queued: "Queued", running: "Running", done: "Done", waiting: "Waiting on you" },
  steps: [
    { id: "quote", title: "Quote", body: "Your ZIP, your home's size, and the type of clean set the price. Extras are listed line by line.", note: "Deep clean · 4 lines" },
    { id: "schedule", title: "Schedule", body: "Pick an open time. Reschedule later from your confirmation text.", note: "Thu 9:00 AM" },
    { id: "match", title: "Match", body: "A cleaner is matched by location, availability, and ratings.", note: "Maria R. assigned" },
    { id: "clean", title: "Clean", body: "Your cleaner works from the written checklist for your service.", note: "Checklist complete" },
    { id: "check", title: "Check", body: "Rate the visit. Anything missed is re-cleaned free within 48 hours.", note: "Rate within 48 hours" },
  ],
} as const;

export const NOVA = {
  id: "nova",
  eyebrow: "Booking assistant",
  headline: "Nova",
  lead: "Nova answers our booking line day and night. It is an AI assistant, and it says so. It can price your home, book a time, and pass you to a person.",
  skills: [
    { id: "quote", name: "Quotes your home", body: "A live price from your ZIP, home size, and type of clean. The same price the website shows.", status: "live" as const },
    { id: "address", name: "Finds your address", body: "Looks up your street from the ZIP so you don't have to spell it twice.", status: "live" as const },
    { id: "checklist", name: "Texts the checklist", body: "Sends the list of what is included before it says a price.", status: "live" as const },
    { id: "book", name: "Books the visit", body: "Holds your time and texts a link to confirm with a deposit.", status: "live" as const },
    { id: "waitlist", name: "Keeps a waitlist", body: "If we don't serve your ZIP yet, it takes your details and says so plainly.", status: "live" as const },
    { id: "person", name: "Hands you to a person", body: "Ask for a person, or ask about damage or billing, and our team follows up.", status: "live" as const },
  ],
  statusLabel: { live: "Live" },
  transcriptLabel: "Sample conversation",
  play: "Play a sample call",
  stop: "Stop",
  callLabel: "Call Nova",
  disclosure: "Nova is an AI assistant. Ask for a person at any time and our team follows up with you.",
} as const;

export const QUOTE_REPORT = {
  id: "prices",
  headline: "Every price shows its math.",
  lead: "These are the starting prices our booking system uses today. Pick a size and a clean. Two things are set when you book: your ZIP and your home's condition.",
  frameLabel: "Quote · Starting price",
  controls: { size: "Home size", service: "Type of clean", frequency: "How often", extras: "Extras" },
  kinds: [
    { id: "base", label: "Base rate", body: "Set by your home's size and the type of clean." },
    { id: "extra", label: "Extra", body: "Only what you add. Each one is listed." },
    { id: "plan", label: "Plan", body: "Monthly membership rate for recurring cleans." },
    { id: "booking", label: "Set at booking", body: "Your ZIP and your home's condition. Shown before you pay." },
    { id: "offer", label: "Offer", body: "New-customer discount, applied when you book." },
  ],
  totalOnce: "Starting at",
  totalPlan: "Per month",
  bookingLine: "Your ZIP and home condition",
  bookingValue: "At booking",
  cta: "Get my exact price",
} as const;

export const SERVICES = {
  id: "services",
  headline: "One team. Every kind of clean.",
  lead: "Homes, moves, rentals, and offices. Each service has its own written checklist.",
  groups: [
    {
      id: "homes",
      label: "Homes",
      items: [
        { id: "standard", name: "Standard clean", body: "Regular upkeep for a home that is already in good shape.", priceKey: "standard" as const, href: "/checklist/standard-clean" },
        { id: "deep", name: "Deep clean", body: "The detail work. Recommended for a first clean.", priceKey: "deep" as const, href: "/checklist/deep-clean" },
        { id: "recurring", name: "Membership", body: "Monthly, every two weeks, or weekly, with a dedicated cleaner on bi-weekly and weekly plans.", priceKey: "plan" as const, href: "/membership" },
      ],
    },
    {
      id: "moves",
      label: "Moves",
      items: [
        { id: "move", name: "Move-in / move-out", body: "An empty home, cleaned inside everything, ready to hand over.", priceKey: "moveInOut" as const, href: "/checklist/move-in-out" },
      ],
    },
    {
      id: "rentals",
      label: "Rentals",
      items: [
        { id: "str", name: "Airbnb turnovers", body: "Linens, restocking, and 8–12 photos after every turnover.", priceKey: null, href: "/str" },
      ],
    },
    {
      id: "business",
      label: "Business",
      items: [
        { id: "commercial", name: "Offices and commercial", body: "Scheduled cleaning for offices and facilities, priced per visit.", priceKey: null, href: "https://commercial.novaracleaning.com" },
      ],
    },
  ],
} as const;

export const HOSTS = {
  id: "hosts",
  headline: "Built for hosts who can't be there.",
  lead: "Request a turnover from the partner portal. The crew works the turnover checklist and sends photos before your next guest arrives.",
  tabs: [
    {
      id: "turnover",
      label: "Every turnover",
      title: "The turnover checklist",
      body: "The same list on every property, every time.",
      items: [
        "Strip and remake every bed with fresh linens",
        "Restock toiletries, coffee, and paper goods to your spec",
        "Check every drawer and closet for guest-left items",
        "Test the stove, microwave, dishwasher, and Wi-Fi",
        "Confirm door codes and locks work for the next guest",
      ],
    },
    {
      id: "photos",
      label: "Photo proof",
      title: "8–12 photos after every clean",
      body: "Kitchen, each bathroom, each bedroom, and the living area, plus anything we found.",
      items: [
        "Before and after photos of every room",
        "Damage or missing items reported right away",
        "Staged to your standard appearance reference, if you have one",
      ],
    },
    {
      id: "pricing",
      label: "Pricing",
      title: "A price per turnover, in seconds",
      body: "Price each property on its own page. No sales call needed to see a number.",
      items: ["Priced per property", "Requests and history in the partner portal", "Book a 15-minute call if you want one"],
    },
  ],
  primary: { href: "/str", label: "Price my property" },
  secondary: { href: "https://partner.novaracleaning.com", label: "Host sign in" },
} as const;

export const PROMISES = {
  id: "promises",
  headline: "Our promises are policies.",
  lead: "These are how the business runs, not badges.",
  steps: ["Clean", "Your check", "Re-clean if needed"],
  items: [
    "You see the exact price before you pay.",
    "Every visit follows the written checklist for your service.",
    "Anything missed is re-cleaned free if you tell us within 48 hours.",
    "Cancel more than 24 hours ahead for a full refund. Inside 24 hours the fee is $50.",
    "Nova always says it is an AI. Ask for a person and our team follows up.",
    "Airbnb turnovers include 8–12 photos of the finished property.",
  ],
  demo: {
    introTitle: "Try a re-clean request",
    introBody: "Pick what was missed. This is a sample; nothing is sent.",
    label: "Example with sample data",
    visit: "Standard clean · Tue 10:00 AM",
    within: "Reported 6 hours after the visit",
    areas: ["Kitchen", "Bathrooms", "Bedrooms", "Living areas"],
    submit: "Request a re-clean",
    sentTitle: "Re-clean scheduled",
    sentBody: "A cleaner comes back for the areas you picked. No charge.",
    reset: "Reset example",
  },
} as const;

export const PRICING = {
  id: "pricing",
  headline: "Pricing",
  once: {
    name: "One-time clean",
    priceLabel: (from: string) => `Starting at ${from}.`,
    includes: [
      "Standard, deep, or move-in/out",
      "Written checklist on every visit",
      "48-hour re-clean if something is missed",
      "New customers: 15% off standard, 25% off deep",
    ],
    note: "Your exact price depends on your ZIP and your home. You see it before you pay.",
    cta: "Get my price",
  },
  plan: {
    name: "Membership",
    priceLabel: (from: string) => `Starting at ${from} per month.`,
    includes: [
      "Monthly, every two weeks, or weekly",
      "Dedicated cleaner on bi-weekly and weekly plans",
      "Discounts on deep cleans and add-ons",
      "Pause or reschedule when you need to",
    ],
    note: "The first month starts with a deep clean so every visit after is upkeep.",
    cta: "See membership plans",
    href: "/membership",
  },
} as const;

export const FAQ = {
  id: "faq",
  headline: "Frequently asked questions",
  items: [
    { q: "How is my price set?", a: "Your home's size and the type of clean set the base price. Your ZIP code and your home's condition are added when you book. You see the exact total before you pay." },
    { q: "Do I need to be home?", a: "No. Many customers leave a door code or a key. You get text updates about your visit." },
    { q: "Is Nova a person?", a: "No. Nova is an AI assistant, and it tells you so. It can price your home and book a time. If you ask for a person, our team follows up with you." },
    { q: "What if something is missed?", a: "Tell us within 48 hours and a cleaner comes back to re-clean those areas. There is no charge." },
    { q: "Can I cancel?", a: "Yes. Cancel more than 24 hours before your visit for a full refund. Inside 24 hours there is a $50 short-notice fee." },
    { q: "Where do you clean?", a: "Homes across Maryland, Washington DC and Northern Virginia. Enter your ZIP code to check yours. If we don't serve it yet, we'll add you to the waitlist." },
    { q: "What do I need to provide?", a: "Nothing. Your cleaner brings the supplies and equipment for your service." },
  ],
} as const;

export const FINAL_CTA = {
  headline: "Get your price. Book in a minute.",
  body: "Enter your ZIP to see what your clean costs. Or call Nova, day or night.",
  primary: "Get my price",
  secondary: "Call",
} as const;

export const FOOTER = {
  tagline: "House cleaning with the price up front.",
  company: "Novara Cleaning LLC. 7404 Executive Place, Lanham, MD 20706",
  columns: [
    {
      title: "Services",
      links: [
        { href: "/checklist/standard-clean", label: "Standard clean" },
        { href: "/checklist/deep-clean", label: "Deep clean" },
        { href: "/checklist/move-in-out", label: "Move-in / move-out" },
        { href: "/membership", label: "Membership" },
        { href: "/str", label: "Airbnb turnovers" },
        { href: "https://commercial.novaracleaning.com", label: "Commercial" },
      ],
    },
    {
      title: "Company",
      links: [
        { href: "#how", label: "How it works" },
        { href: "#nova", label: "Nova" },
        { href: "#faq", label: "FAQ" },
        { href: "https://hiring.novaracleaning.com", label: "Work with us" },
        { href: "/auth", label: "Sign in" },
      ],
    },
    {
      title: "Legal",
      links: [
        { href: "https://novaracleaning.com/privacy", label: "Privacy" },
        { href: "https://novaracleaning.com/terms", label: "Terms" },
        { href: "https://novaracleaning.com/cancellation-policy", label: "Cancellation policy" },
        { href: "https://novaracleaning.com/refund-policy", label: "Refund policy" },
        { href: "https://novaracleaning.com/membership-policy", label: "Membership policy" },
        { href: "/privacy-request", label: "Privacy requests" },
      ],
    },
  ],
} as const;
