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

export const ONBOARDING_GUIDES: OnboardingGuide[] = [
  {
    id: "dress_code",
    title: "Dress code",
    lede:
      "You are entering a client's home as a representative of NovaraCleaning. " +
      "Appearance is part of the service.",
    image: "/onboarding/dress-code.png",
    alt: "NovaraCleaning contractor dress code: required and not-permitted clothing for a job",
    points: [
      "Clean, unstained, work-appropriate clothing",
      "Closed-toe, non-slip shoes",
      "Clothing that stays modest and secure through bending, reaching, kneeling and lifting",
      "No low-cut tops, short skirts or dresses, or crop tops",
      "No torn, dirty or visibly worn clothing",
      "No loose jewelry that could catch on surfaces or furniture",
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
    title: "Your job day, start to finish",
    lede: "Every job follows the same shape, so there are no surprises on day one.",
    image: "/onboarding/job-day-journey.png",
    alt: "The NovaraCleaning job day journey from accepting an offer through to getting paid",
    points: [
      "An offer reaches you by text and on your dashboard — accept or decline it",
      "Read the job before you drive: address, arrival window, scope and client notes",
      "Open the checklist before you arrive — it is the agreed scope of the job",
      "Work the checklist live, one area at a time, ticking as you go",
      "Photograph the work as you finish each area",
      "Message dispatch from the field the moment something does not match the job",
      "Complete the job; pay lands 1–2 business days later",
    ],
    footnote:
      "The walkthroughs on your Training page cover each of these steps in the real app.",
    actionLabel: "I've read the job-day journey",
  },
];

export function onboardingGuide(id: OnboardingGuideId): OnboardingGuide {
  const found = ONBOARDING_GUIDES.find((g) => g.id === id);
  if (!found) throw new Error(`Unknown onboarding guide: ${id}`);
  return found;
}
