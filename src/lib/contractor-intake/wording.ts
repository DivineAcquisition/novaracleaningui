// Disclosures and notices. Each version is Draft until the owner marks it Reviewed.

export type WordingStatus = "draft" | "reviewed";

export interface WordingVersion {
  id: string;
  version: number;
  status: WordingStatus;
  title: string;
  body: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

export const WORDING_STATUS_LABEL = "Draft pending legal review";

function draft(id: string, title: string, body: string): WordingVersion {
  return { id, version: 1, status: "draft", title, body };
}

export const INTAKE_WORDING: WordingVersion[] = [
  draft(
    "application_sms",
    "Application text messages",
    "Novara Cleaning may text this number about your application, onboarding steps, and, if you are approved, job offers. Messages are occasional. Message and data rates may apply. Reply STOP to opt out and HELP for help. See the privacy notice. This is optional and is not required to apply.",
  ),
  draft(
    "application_email",
    "Application email",
    "Novara Cleaning may email this address about your application and onboarding. If you decline texts, email is how we reach you, and this box is required so we have one way to contact you.",
  ),
  draft(
    "independent_contractor",
    "Independent contractor acknowledgment",
    "This is independent contractor work, not employment. You provide a W-9 during onboarding and handle your own taxes. Novara does not withhold taxes.",
  ),
  draft(
    "application_privacy",
    "Application privacy notice",
    "We collect your name, email, mobile number, street address, city, state, ZIP, the supplies you mark, and your written answers so we can decide whether you qualify. People on the Novara hiring team can open it. We do not collect a Social Security number, a date of birth, or criminal history on this application. A photo of your government ID and a selfie are collected later, only if you are conditionally approved, and only to confirm your identity. Those images are deleted on the schedule in settings. A background check, if one is ordered, happens after a conditional approval and needs a separate authorization. You can ask to see, correct, or delete what we hold by emailing privacy@novaracleaning.com.",
  ),
  draft(
    "why_vehicle",
    "Why we ask about a vehicle",
    "This role requires a personal vehicle you can drive to jobs. Jobs require carrying a full supply kit between homes. This is verified later with your license and vehicle documents.",
  ),
  draft(
    "why_supplies",
    "Why we ask about supplies",
    "You supply your own products and equipment as an independent contractor. You will photograph your kit during onboarding.",
  ),
  draft(
    "why_age",
    "Why we ask about age",
    "This role is open to people who are 18 or older. We do not ask for your date of birth.",
  ),
  draft(
    "why_phone",
    "Why we ask about a smartphone",
    "Job offers, check-in, and photos run in the Novara app on your phone.",
  ),
  draft(
    "identity_consent",
    "Identity verification",
    "A face match compares your selfie to your ID photo to confirm you are the person who applied. The verification provider performs the match. Images are used only for identity verification. If you do not consent, a person at Novara can review a secure upload instead.",
  ),
  draft(
    "vehicle_reason",
    "Vehicle verification",
    "Jobs require driving between homes with a full supply kit. We verify this so every cleaner on our network can reliably reach jobs.",
  ),
  draft(
    "background_disclosure",
    "Background check disclosure",
    "Novara Cleaning may obtain a consumer report about you, which may include a criminal-history check and, if you authorize it, a driving record. This screen is only that disclosure.",
  ),
  draft(
    "background_authorization",
    "Background check authorization",
    "I authorize Novara Cleaning to obtain a consumer report for contractor onboarding. I understand a separate decision, if any, is made by Novara and not by the background check company.",
  ),
  draft(
    "lead_addendum",
    "Lead Field Cleaner addendum",
    "A lead job may be accepted or declined. Lead jobs pay the lead rate in your settings. Solo jobs stay at your normal rate. Walkthrough and trial notes are factual records. You have no authority to approve, reject, discipline, set pay for, or remove another contractor. Novara pays every contractor directly. You can step down from lead status at any time.",
  ),
  draft(
    "before_start_title",
    "Before you start title",
    "You are conditionally approved. Here is what happens next.",
  ),
  draft(
    "before_start_intro",
    "Before you start intro",
    "Approval depends on finishing onboarding online. No phone call is required. Your link stays open until {deadline}. Time spent waiting on Novara does not count against you.",
  ),
  draft(
    "before_start_question",
    "Before you start question",
    "Are you ready to start now?",
  ),
  draft(
    "before_start_not_yet",
    "Before you start, not yet",
    "No problem. We saved your spot. We will send you a reminder with your link. Your link is open until {deadline}.",
  ),
  draft(
    "before_start_safety_id",
    "Before you start, ID privacy",
    "We use your ID and selfie only to confirm you are the person who applied, and delete them {days} days after your result.",
  ),
  draft(
    "before_start_safety_ssn",
    "Before you start, safety",
    "We will never ask for your full Social Security number or bank details by email or text. Enter them only on this site.",
  ),
  draft(
    "before_start_safety_contractor",
    "Before you start, contractor",
    "This is independent contractor work, not employment. You can stop at any time.",
  ),
  draft(
    "recurring_home_addendum",
    "Recurring Home addendum",
    "A recurring home may be accepted or declined. Recurring homes are residential only. The notice period before you stop servicing a home is set in this addendum. Accepting a recurring home does not change the independent contractor agreement.",
  ),
];

export function wordingById(id: string, versions: WordingVersion[] = INTAKE_WORDING): WordingVersion | null {
  return versions.find((row) => row.id === id) || null;
}

export function isDraft(version: WordingVersion | null | undefined): boolean {
  return !version || version.status !== "reviewed";
}
