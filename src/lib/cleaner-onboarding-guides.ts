// ─── Job-day reference graphics shown during onboarding ─────────────────
//
// Two pictures a contractor should see before their first job: what to wear,
// and what a job day actually looks like end to end. They are graphics rather
// than prose because that is how they were authored, and a contractor
// standing in a supply aisle on their phone reads a picture faster.
//
// The files live in public/onboarding/ rather than in the repo's source tree
// because they are content, not code — replacing a graphic is dropping in a
// new file, with no build change. `points` is the same material in text: it
// is what screen readers get, and what renders if the image cannot load, so
// a missing or blocked asset degrades to something readable instead of a
// broken box in the middle of onboarding.

export type OnboardingGuideId = "dress_code" | "job_day";

export interface OnboardingGuide {
  id: OnboardingGuideId;
  /** Section heading inside the onboarding step. */
  title: string;
  /** One line of framing above the graphic. */
  lede: string;
  /** Path under public/. */
  image: string;
  /** One-page PDF of the same graphic, for the public landing page. */
  pdf: string;
  /** Public page that renders `pdf` with pdf.js — lives under /cleaner/guides/. */
  landingPath: string;
  alt: string;
  /** The graphic's content as text — alt-text fallback, not decoration. */
  points: string[];
  /** Optional closing line under the graphic. */
  footnote?: string;
  /** Button label on the onboarding step. */
  actionLabel: string;
  /** When set, the contractor must tick this before the action enables. */
  agreeLabel?: string;
}

export const OPERATOR_HANDBOOK_PDF = "/onboarding/operator-handbook.pdf";

export const ONBOARDING_GUIDES: OnboardingGuide[] = [
  {
    id: "dress_code",
    title: "Dress code",
    lede:
      "You are entering a client's home as a representative of NovaraCleaning. " +
      "Appearance is part of the service.",
    image: "/onboarding/dress-code.png",
    pdf: "/cleaner/guide-pdfs/dress-code.pdf",
    landingPath: "/cleaner/guides/dress-code",
    alt: "NovaraCleaning contractor dress code: approved black or white shirt with jeans or work pants, closed-toe shoes, and items that are not permitted",
    points: [
      "Solid black or white shirt with jeans or work pants",
      "Closed-toe, non-slip shoes",
      "Clean, unstained clothing with no visible wear",
      "Clothing that stays modest through bending, reaching and kneeling",
      "No low-cut tops, crop tops, shorts, short skirts or dresses",
      "No open-toe shoes or sandals",
      "No torn, stained or worn clothing",
      "No loose jewelry that could catch on surfaces",
    ],
    footnote:
      "The working test: if you would not be comfortable bending down to pick something up in " +
      "front of a client, the outfit is not right for the job. This is about the client's " +
      "comfort in their own home and your own safety while working — not style.",
    actionLabel: "I agree to follow this dress code",
    agreeLabel: "I agree to wear this on every Novara job.",
  },
  {
    id: "job_day",
    title: "Day To Day Job Operations",
    lede: "Same four stops, every single job. This is what a great job looks like.",
    image: "/onboarding/job-day-journey.png",
    pdf: "/cleaner/guide-pdfs/day-to-day-job-operations.pdf",
    landingPath: "/cleaner/guides/day-to-day-job-operations",
    alt: "Day To Day Job Operations: before you go, when you arrive, while you work, before you leave, then job complete",
    points: [
      "Before you go: open the job and read the FULL checklist, access details and property notes, phone charged, supplies loaded",
      "When you arrive: inside your window (late? call first), greet the client, ask about pets, take BEFORE photos of every area",
      "While you work: checklist in order, tick as you finish, one area at a time, ask before moving furniture and put it back",
      "Before you leave: walk every area one final time, AFTER photos of every area, report ANY issue, mark complete in the dashboard",
      "Job complete: photos in, checklist done, nothing left for the client to fix",
      "Show up on time. Work the checklist. Document everything.",
      "Unsure? Call the office — you are never in trouble for asking",
    ],
    footnote:
      "The walkthroughs on your Training page cover each of these steps in the real app.",
    actionLabel: "I've read Day To Day Job Operations",
  },
];

export function onboardingGuide(id: OnboardingGuideId): OnboardingGuide {
  const found = ONBOARDING_GUIDES.find((g) => g.id === id);
  if (!found) throw new Error(`Unknown onboarding guide: ${id}`);
  return found;
}

export function onboardingGuideLandingSlugs(): string[] {
  return ONBOARDING_GUIDES.map((g) => g.landingPath.replace("/cleaner/guides/", ""));
}

export function guideByLandingSlug(slug: string): OnboardingGuide | undefined {
  return ONBOARDING_GUIDES.find((g) => g.landingPath === `/cleaner/guides/${slug}`);
}
