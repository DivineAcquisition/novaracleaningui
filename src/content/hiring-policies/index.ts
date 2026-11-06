// Hiring policies for hiring.novaracleaning.com/policies.
//
// Written from the wording the application and onboarding already show
// (src/lib/hiring/application.ts, src/lib/contractor-intake/wording.ts) and the
// role catalog (src/lib/hiring/roles.ts). Same text markers as the customer
// policies: "## " section, "### " subsection, blank line between blocks.

export const HIRING_POLICY_UPDATED = "November 6, 2026";
export const HIRING_CONTACT = "operations@novaracleaning.com";

export type HiringPolicySlug = "applicant-privacy" | "background-check" | "contractor-terms" | "text-messages" | "equal-opportunity";

export interface HiringPolicy {
  slug: HiringPolicySlug;
  title: string;
  summary: string;
  text: string;
}

const applicantPrivacy = `
## 1. WHO WE ARE

Novara Cleaning LLC (“Novara”, “we”, “us”) runs hiring.novaracleaning.com, where people apply to clean with Novara as independent contractors. This notice explains what we collect when you apply and go through onboarding, why, who can see it, how long we keep it, and how to reach us. Customers of our cleaning service are covered by our customer Privacy Policy at novaracleaning.com/privacy.

## 2. WHAT WE COLLECT WHEN YOU APPLY

The application asks for:

Your name, email address, and mobile number

Your street address, city, state, and ZIP code

The role you are applying for and your answers to the application questions

Whether you are 18 or older, have a valid driver’s license, and drive an insured car

The cleaning supplies you already have

A photo of your current, unexpired government-issued photo ID

Your choices on the consent boxes, with the date, time, and the version of the wording you saw

We do not ask for a Social Security number, a date of birth, bank details, or criminal history on the application. Do not upload a Social Security card, a Social Security number, or immigration documents. The ID photo is not an employment-eligibility form (not an I-9).

## 3. WHAT WE COLLECT DURING ONBOARDING

If you are conditionally approved, onboarding online may also collect:

A photo of your ID and a selfie for identity verification. A face match compares the selfie to the ID photo to confirm you are the person who applied. If you do not consent to the face match, a person at Novara can review a secure upload instead.

Your driver’s license and vehicle documents, to confirm you can drive between jobs

Photos of your supply kit

A W-9 for tax reporting, and your payout details for paying you

Your signed independent contractor agreement and any role addendum

Your authorization for a background check, collected separately and only right before a check is ordered (see our Background Check Disclosure)

## 4. HOW WE USE IT

We use this information only to decide whether you qualify, to confirm your identity, to complete onboarding, to offer and pay for jobs if you are approved, and to keep records the law requires. We do not sell your information.

## 5. WHO CAN SEE IT

People on the Novara hiring and operations team can open your application. ID images are visible only to Novara hiring staff. Service providers that help us run hiring (hosting, identity verification, background screening by Checkr, messaging, and payments) handle your information only to provide those services to Novara.

## 6. HOW LONG WE KEEP IT

ID photos and selfies are kept only to confirm your identity. All ID images, including the ID photo from your application, are deleted 30 days after your hiring result. We keep your application, consent records, and, if you work with us, your agreement and tax records for as long as the law requires.

## 7. YOUR CHOICES

You can ask to see, correct, or delete the information we hold about you by emailing operations@novaracleaning.com. Some records, such as signed agreements, consent records, and tax forms, must be kept even after a deletion request. You can stop the application or onboarding at any time.

We will never ask for your full Social Security number or bank details by email or text. Enter them only on this site.

## 8. CHANGES AND CONTACT

If we change this notice, we update the date at the top of this page. Questions: operations@novaracleaning.com. Novara Cleaning LLC, 7404 Executive Place, Lanham, MD 20706.
`;

const backgroundCheck = `
## 1. DISCLOSURE

Before anyone is offered work, Novara Cleaning LLC may obtain a consumer report about you for contractor onboarding. The report may include a criminal-history check and, if you authorize it, a driving record. We may decline an application based on information in that report.

This page is the disclosure only. A separate signed authorization, required by the Fair Credit Reporting Act (FCRA), is collected immediately before a check is ordered. Nothing is assigned until the check clears.

## 2. WHO PREPARES THE REPORT

Reports are prepared by Checkr, Inc., a consumer reporting agency. Checkr provides the report; any decision about working with Novara is made by Novara, not by Checkr. Checkr’s contact details and your rights under the FCRA are provided with the authorization you sign.

## 3. WHEN IT HAPPENS

A background check is ordered only after a conditional approval, and only after you sign the separate authorization. It is not run when you submit an application.

## 4. IF THE REPORT AFFECTS OUR DECISION

If information in the report may lead us to decline you, we will first send you a pre-adverse action notice with a copy of the report and “A Summary of Your Rights Under the Fair Credit Reporting Act”, and give you time to respond before we make a final decision.

If we then decline you, we will send an adverse action notice that names Checkr, explains that Checkr did not make the decision and cannot explain why it was made, and tells you about your right to get a free copy of your report within 60 days and to dispute anything in it that is inaccurate or incomplete with Checkr.

## 5. YOUR RIGHTS

You can request a copy of any report Novara obtains about you. You can dispute inaccurate or incomplete information directly with Checkr. Maryland, Washington DC, and Virginia law may give you additional rights.

## 6. CONTACT

Questions about screening: operations@novaracleaning.com.
`;

const contractorTerms = `
## 1. INDEPENDENT CONTRACTOR, NOT EMPLOYMENT

You work with Novara Cleaning LLC as an independent contractor, not as a W-2 employee. Novara does not withhold taxes, and you are not on payroll or benefits. You accept jobs, bring your own supplies, and get paid for completed work. You can stop at any time.

These terms summarize what applicants agree to understand when they apply. The contractor agreement you sign during onboarding is the binding document; if anything here differs from your signed agreement, the agreement controls.

## 2. TAXES

You provide a W-9 during onboarding and handle your own taxes. At tax time you file your own return. If your pay for the year meets the IRS threshold, Novara files a 1099-NEC that reports what we paid you.

## 3. PAY

Pay is a percentage of the job price, paid to you as an independent contractor. Your final pay rate is stated in your agreement.

Field Cleaner: 35–45% of the job price, starting at 35% and rising as you prove yourself

Lead Field Cleaner: 47% of the job price on jobs you lead. Solo jobs stay at your normal rate.

If a job is more than 35 miles away, you also get surge pay and mileage pay for that travel.

Novara pays every contractor directly.

## 4. ACCEPTING JOBS

You may accept or decline any job offer, including lead jobs and recurring homes. A recurring home may be accepted or declined; the notice period before you stop servicing a recurring home is set in its addendum. Accepting a recurring home does not change the independent contractor agreement.

Lead contractors have no authority to approve, reject, discipline, set pay for, or remove another contractor. You can step down from lead status at any time.

## 5. SUPPLIES AND VEHICLE

You supply your own products and equipment. Every job requires you to show up prepared with the proper equipment, and you photograph your kit during onboarding. Field roles require a personal vehicle you can drive to jobs, a valid driver’s license, and car insurance.

## 6. INSURANCE

Novara maintains commercial general liability insurance for assigned jobs. You are responsible for your own car insurance. Any other insurance the contractor agreement requires is confirmed before you are offered work.

## 7. CONFIDENTIALITY

Client names, addresses, and door codes stay confidential. Photos of client homes do not go on social media.

## 8. CLIENT NON-SOLICITATION

If you are offered work, the contractor agreement includes a 24-month client non-solicitation covenant: during the engagement, and for 24 months after it ends, you do not solicit or clean for clients you met through Novara. The full covenant, including damages, is read at screening and signed in the agreement.

## 9. CONTACT

Questions: operations@novaracleaning.com.
`;

const textMessages = `
## 1. WHAT YOU AGREE TO

If you check the text-message box on the application, Novara Cleaning LLC may text and call the mobile number you provide about your application, your onboarding steps, and, if you are approved, job offers. Texting is optional and is not required to apply. If you decline texts, we use email to reach you.

## 2. HOW OFTEN

Messages are occasional and tied to your application, onboarding, and job offers. Message frequency varies.

## 3. COST

Message and data rates may apply, based on your mobile plan.

## 4. STOP AND HELP

Reply STOP to any message to opt out of texts. Reply HELP for help, or email operations@novaracleaning.com. Opting out of texts does not withdraw your application.

## 5. PRIVACY

We do not sell your mobile number or share it for marketing. Mobile opt-in data and consent are not shared with third parties for their marketing. See our Applicant Privacy Notice for how we handle your information.
`;

const equalOpportunity = `
## 1. OUR COMMITMENT

Novara Cleaning LLC welcomes applicants and contractors of every background. We decide who joins our network based on the requirements of the work: the role’s qualifications, identity verification, screening, and the ability to reliably reach jobs with the right supplies.

## 2. NON-DISCRIMINATION

We do not discriminate on the basis of race, color, religion, sex, age, national origin, ancestry, marital status, familial status, sexual orientation, gender identity, genetic information, disability, military or veteran status, or any other characteristic protected by federal, Maryland, Washington DC, or Virginia law.

## 3. ACCOMMODATIONS

If you need an accommodation to apply or to complete onboarding, email operations@novaracleaning.com and tell us what would help. You do not have to share a diagnosis.

## 4. BACKGROUND CHECKS

We do not ask about criminal history on the application. Any background check happens only after a conditional approval and with your separate written authorization, as described in our Background Check Disclosure.

## 5. CONCERNS

If you believe you were treated unfairly, email operations@novaracleaning.com. We review every concern, and we do not retaliate against anyone for raising one.
`;

export const HIRING_POLICIES: HiringPolicy[] = [
  {
    slug: "applicant-privacy",
    title: "Applicant Privacy Notice",
    summary: "What we collect when you apply and onboard, who can see it, and when ID photos are deleted.",
    text: applicantPrivacy,
  },
  {
    slug: "background-check",
    title: "Background Check Disclosure",
    summary: "When a background check happens, who prepares it, and your rights if it affects our decision.",
    text: backgroundCheck,
  },
  {
    slug: "contractor-terms",
    title: "Independent Contractor Terms",
    summary: "1099 work, pay as a percentage of each job, supplies, insurance, confidentiality, and non-solicitation.",
    text: contractorTerms,
  },
  {
    slug: "text-messages",
    title: "Text Message Terms",
    summary: "What texts you get about your application, how often, and how to stop them.",
    text: textMessages,
  },
  {
    slug: "equal-opportunity",
    title: "Equal Opportunity",
    summary: "We do not discriminate, and we make accommodations so anyone qualified can apply.",
    text: equalOpportunity,
  },
];

export function getHiringPolicy(slug: string): HiringPolicy | undefined {
  return HIRING_POLICIES.find((p) => p.slug === slug);
}
