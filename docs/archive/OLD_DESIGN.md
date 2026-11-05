# Previous site design (archived 2026-11-05)

`old-design-2026-11-05.zip` holds the public site and customer pages exactly as
they were on `main` at commit `e5a543d` ("Sync applicant stage with contractor
status…"), before the landing page redesign was merged.

It covers the files the redesign changed:

- Landing page: `src/views/Index.tsx`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/components/SEO.tsx`
- Checklists: `src/views/Checklist.tsx`, `src/views/ChecklistIndex.tsx`
- Membership: `src/views/Membership.tsx`, `src/views/membership/PlanDetail.tsx`, `src/app/membership/**/page.tsx`
- Airbnb hosts: `src/views/str/StrLanding.tsx`
- Booking flow: `src/views/book/{Zip,Offer,Checkout,CustomQuote,Success}.tsx`, `src/components/booking/BookingHeader.tsx`
- Sign-in and portal: `src/views/{Auth,ResetPassword,Account,ManageBooking}.tsx`, `src/views/portal/MemberBooking.tsx`, `src/components/portal/PortalLayout.tsx`
- Theme: `src/app/globals.css`, `tailwind.config.ts`

Files the redesign added (and that the old design does not use) are not in the
zip: `src/components/landing/*`, `src/lib/landing/*`, `src/components/auth/CustomerAuthShell.tsx`,
`src/app/book/layout.tsx`, `src/app/manage-booking/layout.tsx`, `src/app/manage-recurring/layout.tsx`.

## Look at it

The same design is always available in git:

```bash
git show e5a543d:src/views/Index.tsx      # one file
git switch --detach e5a543d && npm run dev # the whole old site, locally
```

## Restore it

```bash
unzip -o docs/archive/old-design-2026-11-05.zip   # overwrite the changed files
rm src/app/book/layout.tsx src/app/manage-booking/layout.tsx src/app/manage-recurring/layout.tsx
```

Then remove the `.book-theme`, `.landing`, and `.flow-light` blocks at the end
of `src/app/globals.css` if they are still there, and run `npm run build`.
