# Home-Service Landing Page UI Components and Section Patterns (for Novara Cleaning overhaul)

> **Method note, read first:** This session's network policy blocked direct fetches of every live site tried (mollymaid.com, homeaglow.com, handy.com, maidthis.com, jumpfly.com all returned ENOTFOUND). As a result, **no live homepage was walked section by section.** Every finding below comes from web-search snippets of company pages, vendor docs, and secondary write-ups (Nov 2026). Notes marked "Inference" are design judgment or general industry knowledge and carry no source. To get exact section order for each site, someone needs to allow those hosts and re-run, or check them by hand in a browser.

## 1. Hero variants and headline formulas

### Takeaway
The large cleaning franchises (Molly Maid, Merry Maids, MaidPro) lead with a ZIP lookup plus a "free estimate" CTA, which routes visitors to a local franchise. Marketplaces (Homeaglow, TIDY) lead with a price hook ($19 first clean, "from $55"). Trades sites (HVAC/plumbing) pair "Book Online 24/7" with a phone CTA and put financing or coupons near the hero. Novara's ZIP-first hero follows the franchise pattern. Adding a visible price anchor would bring it closer to the marketplace pattern.

### Cited Findings
- Molly Maid homepage: "Find a Molly Maid Near Me" ZIP lookup ("Enter Zip/Postal Code to find local Molly Maid") plus a "Request a Free Quote" form promised to take "under 2 minutes." The phone number shown varies by page ((800) 665-5962 on the homepage, (833) 860-2987 elsewhere), which suggests call tracking. — [Molly Maid](https://www.mollymaid.com/); [Molly Maid estimate page](https://www.mollymaid.com/request-a-free-estimate/)
- Molly Maid location pages describe an in-home estimator visiting the property, and pricing is set per franchise, so there is no national price. — [Molly Maid East Phoenix](https://www.mollymaid.com/locations/east-phoenix-paradise-valley/); [Catalina Cleaning (competitor blog)](https://catalinacleaning.com/blog/molly-maid-vs-independent-cleaning-miami)
- Merry Maids homepage CTA: "Request your free estimate today!", with free quotes and flexible scheduling as selling points. — [Merry Maids](https://merrymaids.com/)
- MaidPro's homepage title and headline lead with a proprietary process: "With Our 49-Point Checklist, You'll LOVE Your Clean!" Location pages use "Contact us today for your free and easy estimate." — [MaidPro](https://www.maidpro.com/); [MaidPro Baltimore](https://www.maidpro.com/baltimorey1)
- Homeaglow's headline offer is a "$19 first cleaning" (3 hours). Several reviews say it is tied to a membership. After the first visit, member rates "start at $18 per hour," and reviewers mention a booking fee that "starts at 5%." — [Homeaglow cost page](https://www.homeaglow.com/hub/content/homeaglow-cost); [The Everygirl](https://theeverygirl.com/homeaglow-cleaning-services-review/); [Hello Cleaners](https://hellocleaners.us/learn/homeaglow-vs-local-cleaning-companies)
- TIDY positions on "starting price $55, no subscription or contracts," set directly against Homeaglow on a comparison landing page. — [TIDY vs Homeaglow](https://www.tidy.com/comparisons/homeaglow)
- Dazzling Cleaning runs a separate paid-traffic deal page ("Get your home cleaned at our most affordable rates") selling membership tiers by hours, with "$25/hr on avg" for members. — [try.dazzlingcleaning.com/deal](https://try.dazzlingcleaning.com/deal)
- HVAC/plumbing heroes: One Hour Heating & Air uses one band that pairs booking and calling ("Book Online with Us 24/7"). Anderson Plumbing, Heating & Air puts a financing strip above the header and keeps a booking widget fixed on screen. — [ppc.io HVAC landing page examples](https://ppc.io/hvac-landing-page-examples); [ServiceTitan blog](https://www.servicetitan.com/blog/hvac-websites); [Colorlib](https://colorlib.com/wp/hvac-company-website-examples/)
- A plumbing teardown highlights heroes that split three paths: emergency call, estimate, and online appointment. — [Moda plumbing teardowns](https://moda.app/blog/plumbing-website-design)
- Lawn Love and LawnStarter use an address-first hero. Satellite mapping turns the address into an instant exact price (Lawn Love: "quotes in two minutes or less"). — [Lawn Love near-me](https://lawnlove.com/near-me); [LawnStarter instant quote](https://www.lawnstarter.com/blog/lawnstarter/how-does-lawnstarter-instant-quote-work/)
- Copy level: Unbounce's 2024 benchmark (41k pages, 57M conversions) found copy at a 5th–7th grade reading level converted at 11.1%, versus 7.1% for 8th–9th grade and 5.3% for professional-level copy. Word count and reading time were negatively correlated with conversion. — [DMN summary of Unbounce 2024](https://dmn.ca/unbounces-2024-conversion-benchmark-report-proves-that-attention-spans-are-declining-and-so-are-conversion-rates/); [Martech Cube](https://www.martechcube.com/unbounce-2024-conversion-benchmark-report/)

### Inferences
- Hero taxonomy for the designer:
  - (a) **ZIP-first**: franchises, Novara today.
  - (b) **Price-anchor-first**: Homeaglow $19, TIDY $55.
  - (c) **Address-to-instant-price**: lawn marketplaces.
  - (d) **Book + call dual CTA**: HVAC/plumbing.
  - (e) **Process-as-headline**: MaidPro 49-point, The Maids 22-step.
- For Novara, a strong split hero would combine ZIP + bedrooms/bathrooms + a live "from $X" price (b + a), with a secondary "Airbnb host? Get turnover pricing" link and a tap-to-call number.
- Headline formulas seen: [Outcome] + [proof device] ("You'll LOVE your clean" + 49-point checklist), [Price] + [offer] ("$19 first clean"), [Speed/ease] ("quote in under 2 minutes").

### Gaps
- Exact hero layouts (photo vs video, form placement) for Molly Maid, Merry Maids, The Maids, Handy, Homeaglow, MaidThis could not be confirmed because live fetches were blocked.
- No data on video heroes for cleaning sites was found.

## 2. Instant quote, price calculators, booking widgets, calendars

### Takeaway
The standard cleaning booking form is built from these inputs: bedrooms, bathrooms, (optional) square footage, service type, frequency (with discounts), add-on extras, and a running price summary. This is built into BookingKoala and Launch27. Franchises instead collect leads and run estimates, often in person.

### Cited Findings
- A live BookingKoala booking page (Complete Cleaners) has a frequency selector (one-time / weekly / every other week / every 4 weeks), an extras list (inside oven, inside fridge, inside cabinets, baseboards, blinds, pet hair, etc.; each priced or free), a booking summary panel, and a "15% off" banner. — [completecleaners.bookingkoala.com/booknow](https://completecleaners.bookingkoala.com/booknow)
- BookingKoala can price by sq ft, room count, hours, or flat packages, and supports recurring frequency options. Reported plan prices conflict across sources: $27/$57/$197 per month in one, ~$59/$79 per month in another. — [fieldservicesoftware.io](https://fieldservicesoftware.io/software/bookingkoala/); [fieldopslab](https://fieldopslab.com/software/bookingkoala/)
- Launch27 gives instant quotes from sq ft, bedrooms, bathrooms, frequency, and add-ons (oven, fridge, windows, inside cabinets). — [ConvertLabs](https://blog.convertlabs.io/cleaning-business-scheduling-software); [MyQuoteIQ](https://myquoteiq.com/best-online-booking-software-cleaning-businesses-2026/)
- An example calculator UI (MioCommerce) shows one-time/monthly/biweekly/weekly options with different discounts and a live itemized summary: base price (by bedrooms), bathroom charges, add-ons, subtotal, total. — [MioCommerce calculator](https://miocommerce.com/free-business-tools/house-cleaning-cost-calculator/)
- Calculator patterns: several tools show a price range instead of one number, or say the exact price is "confirmed before you book." Some reveal a contact or booking step only after the estimate. — [Hello Cleaners calculator](https://hellocleaners.us/learn/cleaning-cost-calculator); [Jobber calculator](https://www.getjobber.com/free-tools/house-cleaning-cost-calculator/); [BookToClean](https://booktoclean.com/pricing)
- Published per-bedroom price tables are used as a pricing component. Hello Cleaners lists deep-clean bands from $200–$220 up to $450–$700 by home size. Just Maid 4 You lists flat rates by bedroom (2BR one-time $178). Maid On The Spot shows hourly ($72/hr) with hour estimates by bedroom count (2BR first clean 6–9 hrs, routine 3 hrs). — [Hello Cleaners](https://hellocleaners.us/learn/cleaning-cost-calculator); [Just Maid 4 You](https://www.justmaid4you.com/pricing/); [Maid On The Spot](https://maidonthespot.com/prices/)
- MaidThis describes itself as a referral marketplace where cleaners set rates, but the site shows "a flat-rate price for simplicity." It markets "House & Airbnb Cleaning." — [MaidThis services](https://maidthis.com/our-services)
- Maidily is scheduling/booking software for cleaning businesses (3 editions, $30–$100), not a consumer cleaning brand. — [G2 Maidily pricing](https://www.g2.com/products/maidily/pricing); [Maidily features](https://www.maidily.com/features/)
- Trades schedulers: ServiceTitan Online Booking / Scheduling Pro (real-time availability, dispatch sync; Bradham Brothers uses it for 24/7 booking), Housecall Pro Online Booking, and Jobber Online Booking (quicker setup). — [Sitemancer HVAC checklist](https://sitemancer.com/guide/complete-guide-hvac-air-conditioning-and-heating-services-marketing/website-checklist-for-hvac-businesses-scheduling-financing-and-service-areas/); [ServiceTitan blog](https://www.servicetitan.com/blog/hvac-websites)
- Lawn quote price depends on lawn size (from satellite), city, service type, and frequency. LawnStarter also instant-quotes mosquito treatment. A competitor says LawnStarter uses real-estate records instead of satellite, which conflicts with LawnStarter's own claim. — [LawnStarter](https://www.lawnstarter.com/blog/lawnstarter/how-does-lawnstarter-instant-quote-work/); [Lawn Love on LawnStarter](https://lawnlove.com/blog/lawnstarter-review/)
- Turno (STR): hosts sync Airbnb/Vrbo/Booking.com/iCal/Google/Outlook calendars, and Turno "auto-generates cleanings for every reservation and guest checkout." Schedules update when guests extend or cancel. It also offers photo checklists and autopay. — [Turno auto-scheduling](https://turno.com/features/auto-scheduling/); [Turno app listing](https://play.google.com/store/apps/details?id=com.turnoverbnb.host.app&hl=en_US); [Turno photo checklists](https://turno.com/features/photo-checklists/)

### Inferences
- Recommended Novara quote widget (multi-step):
  1. ZIP (service-area check)
  2. Home type toggle: Home / Airbnb-STR
  3. Bedrooms and bathrooms steppers
  4. Service type: Standard / Deep / Move-out / Turnover
  5. Frequency chips with discount badges (e.g., Weekly −20%, Biweekly −15%, Monthly −10%; the discount values are illustrative)
  6. Extras as icon tiles (oven, fridge, cabinets, windows, laundry, linens/restock for STR)
  7. Date + time-slot picker
  8. Contact
  
  Keep a sticky price summary on desktop and a bottom-sheet summary on mobile.
- The STR path should borrow Turno's language: "sync your Airbnb calendar," auto-scheduled turnovers, photo-verified checklists, linen/restock add-ons.

### Gaps
- Handy, TIDY, Homeaglow, Thumbtack, and Angi booking-step details were not verified (fetch blocked).
- Housecall Pro widget UI details were not found.
- No public A/B data on showing a price vs "get a quote" for cleaning specifically.

## 3. Trust and social proof components

### Takeaway
Reviews are the strongest trust lever. The 2026 BrightLocal data show rising star-rating thresholds (31% require ≥4.5 stars) and a recency expectation (74% want reviews from the last 3 months). **Novara's "Google Guaranteed" badge appears outdated.** Third-party sources report Google folded it into a single "Google Verified" badge in Oct 2025 and dropped the money-back guarantee.

### Cited Findings
- BrightLocal Local Consumer Review Survey 2026 (1,002 US adults):
  - 97% read reviews for local businesses.
  - 41% "always" read reviews when browsing, up from 29% in 2025.
  - 31% only use businesses rated ≥4.5, up from 17%.
  - 68% require at least 4 stars.
  - Only ~10% require a perfect 5.0.
  - 74% look for reviews from the last 3 months.
  
  — [BrightLocal 2026](https://www.brightlocal.com/research/local-consumer-review-survey/); [PinMeTo summary](https://www.pinmeto.com/news/brightlocal-local-consumer-review-survey-2026/); [TapReview summary](https://www.usetapreview.com/blog/brightlocal-2026-consumer-review-survey-star-ratings)
- Google LSA badges: from Oct 20, 2025, "Google Guaranteed," "Google Screened," and "License Verified by Google" were consolidated into one "Google Verified" badge, and the Google Guaranteed money-back guarantee was discontinued. — [JumpFly (via search)](https://www.jumpfly.com/blog/google-local-service-ads-launch-consolidated-google-verified-badge/); [Search Engine Land](https://searchengineland.com/google-to-update-local-services-ads-policies-in-july-479653)
- Google was reported to rename "Local Services platform policies" to "Local Services Ads requirements" on July 6 (2026), with verification-first rules. Whether this took effect is unconfirmed. — [TechWyse](https://www.techwyse.com/news/platform-updates/google-local-services-ads-requirements-july-2026)
- Whether you may put the LSA badge graphic on your own website is unresolved publicly. A Local Search Forum thread raises trademark and suspension risk and gives no authoritative answer, and no official Google page on website badge use was found. — [Local Search Forum](https://localsearchforum.com/threads/can-local-service-businesses-display-the-google-guaranteed-verified-badge-on-their-site.63421/)
- Third-party summaries say LSA verification involves business verification, background checks, and proof of insurance/licensing (not Google's wording). — [Stackmatix](https://www.stackmatix.com/blog/google-local-services-ads-guide)
- Proprietary process as a trust device:
  - MaidPro: "49-Point Checklist," with a dedicated /checklist page.
  - The Maids: "22-Step Healthy Touch Deep Cleaning System," HEPA vacuums.
  - Molly Maid: a 44-point checklist is referenced (sources are inconsistent).
  
  — [MaidPro checklist](https://www.maidpro.com/checklist); [Catalina Cleaning compare](https://catalinacleaning.com/compare); [Franchise Chatter](https://www.franchisechatter.com/2017/12/14/15-best-house-cleaning-maid-service-franchises-2017-2018/)
- Guarantee components:
  - Molly Maid ("Neighborly Done Right Promise"): contact by the next business day and the crew re-cleans the affected area at no charge.
  - MaidPro: tell them within 24 hours and they re-clean at no cost.
  
  — [Neighborly / Molly Maid](https://www.neighborly.com/about/molly-maid); [MaidPro](https://www.maidpro.com/)
- Molly Maid runs a comparison page, "Molly Maid vs Independent Providers," under "Why Hire Us." This is a trust/differentiation page pattern. — [Molly Maid why-hire-us](https://mollymaid.com/why-hire-us/molly-maid-vs-independent-providers)
- HVAC sites put awards and reviews directly beneath the hero (Anderson). — [ServiceTitan blog](https://www.servicetitan.com/blog/hvac-websites)

### Inferences
- Novara should rename the badge to "Google Verified" only if it actually holds LSA verification, and should not imply a Google money-back guarantee. Its own 48-hr re-clean guarantee already beats MaidPro's 24 hrs and Molly Maid's next-business-day window. Make that explicit in a comparison chip ("48-hr window vs industry-standard 24 hrs").
- Review components to use:
  - Aggregate rating chip in the hero (★ 4.9 · 300+ Google reviews).
  - A testimonial carousel/marquee showing dates, since 74% want recent reviews.
  - Reviewer first name + neighborhood + service type (Airbnb host vs homeowner).
  - Optional video testimonials.
- Cleaner/team cards (photo, name, years, background-checked) reinforce Novara's "same team" claim. This is common on marketplaces, but not verified for any specific site in this session.

### Gaps
- No primary Google documentation on website display of LSA badges was retrievable.
- No sourced data on BBB badges, "as seen in" logo bars, or live counters affecting conversion in home services.

## 4. Supporting sections: checklists, comparison/pricing tables, memberships, FAQs, service areas, sticky CTAs, chat, promos, footer

### Takeaway
The pattern-library sections seen across sources are:
- Room-by-room "what's included" checklists (MaidPro).
- Per-bedroom pricing tables (independents).
- Membership tiers (Homeaglow, Dazzling).
- Financing strips and coupons (HVAC).
- Service-area/location pages (franchises, Lawn Love city pages).
- Sticky mobile Call + Quote bars (widely recommended by agencies).

### Cited Findings
- MaidPro has a dedicated 49-point checklist page and lets customers drop rooms or tasks, which Molly Maid does not formally offer. That makes a room-by-room inclusion table with toggles a differentiator. — [MaidPro checklist](https://www.maidpro.com/checklist); [Catalina compare](https://catalinacleaning.com/compare)
- Membership/subscription upsells:
  - Homeaglow's $19 intro is linked to membership. One competitor says it auto-renews at $49/mo, which conflicts with $59 figures elsewhere.
  - Dazzling sells hour-based member tiers.
  
  — [A-1 Clean (competitor)](https://a1clean.net/exposing-the-truth-behind-homeaglows-19-cleaning-service/); [Dazzling deal](https://try.dazzlingcleaning.com/deal)
- HVAC financing: 23 of 30 sites in one roundup mention price or financing. Financing strips sit above the header. Coupons/specials are placed next to "Book Now." Multi-trade Penguin Air adds seasonal promos and a chatbot. — [Colorlib HVAC](https://colorlib.com/wp/hvac-company-website-examples/); [ppc.io](https://ppc.io/hvac-landing-page-examples); [InvoiceFly](https://invoicefly.com/academy/hvac-website-designs/)
- Service-area pages: Lawn Love uses city/neighborhood URL hierarchies (e.g., /tennessee/memphis-lawn-care/arlington-lawn-care). Molly Maid uses /locations/<area>/ franchise pages. Lawn Love also has a vacation-rentals use-case page. — [Lawn Love Arlington](https://lawnlove.com:443/tennessee/memphis-lawn-care/arlington-lawn-care); [Lawn Love vacation rentals](https://LAWNLOVE.COM/uses/vacation-rentals); [Molly Maid location](https://www.mollymaid.com/locations/east-phoenix-paradise-valley/)
- Sticky mobile bar: agencies recommend a fixed footer bar on mobile with "Call" and "Instant Quote" buttons, plus a sticky "Book Service" on mobile and a header CTA on desktop. — [Haskell Digital](https://www.haskelldigitalservices.com/blog/website-mistakes-home-service-businesses); [Sitemancer](https://sitemancer.com/guide/complete-guide-hvac-air-conditioning-and-heating-services-marketing/website-checklist-for-hvac-businesses-scheduling-financing-and-service-areas/)
- FAQ: Molly Maid maintains a dedicated FAQ page. — [Molly Maid FAQs](https://www.mollymaid.com/faqs/)

### Inferences
- Novara section additions to consider:
  - "Standard vs Deep vs Move-out vs Airbnb Turnover" comparison table with checkmarks per room.
  - Frequency savings table.
  - A dedicated STR band: calendar sync, same-day turnovers, linen/restock, photo report after each clean, damage/low-supply alerts.
  - City/neighborhood chips linking to area pages.
  - FAQ accordion covering pricing, supplies, pets, keys/access, cancellation, re-clean guarantee, and insurance.
  - Sticky mobile bar: [Call] [Get Price].
- Before/after sliders and photo galleries are common in cleaning marketing (inference). For STR, a photo-report mockup (checklist with photos) is a stronger proof device than a generic before/after.

### Gaps
- No sourced evidence was found on exit-intent offers, chat/SMS widget impact, or before/after slider impact for cleaning sites.
- Footer patterns of specific brands were not verified.

## 5. Conversion-rate evidence (numbers with sources)

### Takeaway
Home-services landing pages convert at a median of roughly 6.7–8.5%, depending on the source. Phone leads are very valuable: home-services calls convert at about 45%, yet only about 52% of calls are answered by a person. Multi-step forms generally beat single-step forms with the same fields. Copy at a 5th–7th grade reading level performs best. Most of these figures are secondary or vendor-sourced.

### Cited Findings
- Home-services landing page median conversion rate is 6.7% (Unbounce 2024), with the top quartile above 17.6%. — [Barham Marketing](https://barhammarketing.com/27-home-services-conversion-rate-statistics-for-2026/). A competing benchmark gives an 8.5% median, 13.2% top quartile, and 18.7% top decile. — [CorePPC](https://coreppc.com/blog/landing-page-conversion-rate-benchmarks-2026/). A third source gives 3.2% with a different population definition. These figures conflict.
- The all-industry median is 6.6% (Unbounce 2024, 41k pages / 57M conversions). — [Martech Cube](https://www.martechcube.com/unbounce-2024-conversion-benchmark-report/)
- Multi-step vs single-step forms:
  - Formstack data: 13.9% vs 4.5% (not home-services-specific). — [IvyForms](https://ivyforms.com/blog/multi-step-forms-single-step-forms/)
  - Unbounce data relayed by a secondary source: multi-step beats single-page with the same fields by ~21% on average. — [Digital Applied](https://www.digitalapplied.com/blog/landing-page-statistics-2026-conversion-data-points)
  - Caveat: for forms under 5 fields, single-step often wins. — [IvyForms](https://ivyforms.com/blog/multi-step-forms-single-step-forms/)
- Phone leads (Invoca, 2026 Home Services report):
  - 38% of person-answered calls are leads, and 45% of those convert on the call.
  - The 2025 edition said 46%, versus 22% for business services and 36% for consumer services.
  - Home-services calls are answered by a person only 52% of the time.
  
  — [Invoca 2026 Home Services report](https://www.invoca.com/reports/the-invoca-home-services-lead-conversion-benchmarks-report-2026); [SupplyHT](https://www.supplyht.com/articles/106612-home-services-call-performance-report-46-lead-conversion-rate-segment-benchmarks); [Invoca blog](https://www.invoca.com/blog/lead-conversion-rate-benchmarks)
- Mobile share: one unverified secondary source claims home services see "well past 70%" mobile on paid landing pages. — [Namastey Network](https://namasteynetwork.com/blog/mobile-traffic-trends.html)
- Page speed: the Google/55/Deloitte "Milliseconds Make Millions" study (2020; 37 brands incl. lead-gen; EU+US) linked a 0.1s mobile speed improvement to an +8.4% retail conversion rate and +10.1% travel conversion. Lead-gen-specific numbers were not retrieved. — [Deloitte PDF](https://www2.deloitte.com/content/dam/Deloitte/ie/Documents/Consulting/Milliseconds_Make_Millions_report.pdf); [web.dev](https://web.dev/milliseconds-make-millions/)
- Reading level: 5th–7th grade copy converts at 11.1% vs 5.3% for professional-level copy (Unbounce 2024). — [DMN](https://dmn.ca/unbounces-2024-conversion-benchmark-report-proves-that-attention-spans-are-declining-and-so-are-conversion-rates/)
- Anecdote only: an agency reports a "109% lift" from adding a sticky call button on an HVAC site. This is a single case, not a controlled test. — [search-result summary of agency blogs incl. Bear North Digital](https://bearnorthdigital.com/blog/contractor-website-conversion-optimization/)

### Inferences
- Because phone leads close at about 45%, Novara should keep tap-to-call prominent (header + sticky bar) alongside the instant-quote form. Answering calls (or an SMS fallback) matters as much as the UI.
- Use a multi-step quote form (ZIP → home details → frequency → contact) rather than one long form. Keep the first step to 1–2 fields so it feels low-commitment.

### Gaps
- No cleaning-specific published A/B tests on instant pricing vs "request quote," review widgets, or form length were found.
- ServiceTitan/Housecall Pro/Jobber published conversion data was not found.
- The Deloitte lead-gen subset numbers were not retrieved.

## 6. Common mistakes / anti-patterns

### Takeaway
Agency sources agree on the common mistakes: a phone number that is hidden or not tappable, no sticky mobile CTA, long forms, generic "Submit" buttons, slow mobile pages, broken forms, and desktop-first layouts. Cleaning-specific risks include opaque intro pricing (the Homeaglow backlash) and outdated or misused badges.

### Cited Findings
- A phone number that is hard to find or tap on mobile, or only in the footer, is cited as the top mistake: "they'll hit the back button and call the next contractor." — [Haskell Digital](https://www.haskelldigitalservices.com/blog/website-mistakes-home-service-businesses); [Orkkid](https://orkkid.com/blog/why-your-service-business-website-doesnt-convert)
- Long contact forms: the recommendation is around three fields (Name, Phone, What You Need). — [Goodfellas Tech](https://www.goodfellastech.com/blog/the-top-10-website-conversion-mistakes-that-lose-leads)
- Vague CTAs ("Submit"); prefer "Get My Free Quote." — [CBX Solutions](https://www.cbx.solutions/free-resources/stop-losing-leads-fix-website-conversion-killers)
- Slow mobile pages, forms that stay broken for months, and desktop-first design with mobile "squeezed in afterward." — [Bear North Digital](https://bearnorthdigital.com/blog/contractor-website-conversion-optimization/); [Cube Creative (pest control)](https://cubecreative.design/blog/pest-control-marketing/website-mistakes-costing-leads)
- Price-bait risk: there is significant third-party and competitor content attacking Homeaglow's $19 offer as membership-linked, with fees and renewals. This shows how a headline price without clear terms creates distrust and gives competitors attack content. — [A-1 Clean](https://a1clean.net/exposing-the-truth-behind-homeaglows-19-cleaning-service/); [Hello Cleaners](https://hellocleaners.us/learn/homeaglow-vs-local-cleaning-companies)
- Outdated LSA badge naming: "Google Guaranteed" no longer exists as a separate badge (see section 3). — [Search Engine Land](https://searchengineland.com/google-to-update-local-services-ads-policies-in-july-479653)

### Inferences
- Other Novara-specific anti-patterns to avoid:
  - A testimonial marquee that auto-scrolls too fast to read and has no dates or sources.
  - A stats strip with unverifiable numbers.
  - Using the same layout for homeowners and STR hosts. Hosts need different proof: turnover speed, calendar sync, photo reports.
  - Showing the ZIP field without saying what happens next.

### Gaps
- The cited anti-pattern sources are agency blogs with no controlled data. No cleaning-specific usability study (e.g., Baymard or NN/g on service booking) was found in this session.
