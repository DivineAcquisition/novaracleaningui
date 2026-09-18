# New Hire Series — support screenshots

Real app captures for the five-video New Hire Series. Regenerated with:

```bash
npm run dev -- --port 3100   # in one terminal
npm run docs:capture -- new-hire
```

Every image is driven by Playwright against this repo's contractor screens.
Supabase is intercepted and answered from `scripts/docs/capture/demo-data.ts`
so no real client, contractor, or payment record can appear.

## Skipped videos

- **Video 1 (welcome):** Welcome is introductory and is not about the app. No screenshot is captured rather than forcing an irrelevant shot.
- **Video 4 (dress-code-professionalism):** No in-app Dress Code reference exists. The contractor Training portal lists Welcome, Standard Clean, Deep Clean & Move-In/Out, Client Interaction, Safety & Chemicals, and Using the Novara App — not dress code. Skipped rather than staged.

## Captured

- `video-2-how-you-get-paid/video2-dashboard-current-tier.png` — Video 2 · Dashboard — Dana is on the Proven tier. Upcoming jobs show the Proven rate (41%) and her share.
- `video-2-how-you-get-paid/video2-pay-payout-breakdown.png` — Video 2 · Pay — a completed job at the Proven rate (41% solo). The Paid chip is the contractor's share of that job.
- `video-2-how-you-get-paid/video2-tips-passthrough.png` — Video 2 · Tips — 100% pass-through. Novara takes nothing; tips never change job pay or scores.
- `video-3-a-day-in-the-field/video3-job-detail-before-arrival.png` — Video 3 · Job detail before arrival — Standard Clean checklist, access notes, and special instructions.
- `video-3-a-day-in-the-field/video3-checklist-midcompletion.png` — Video 3 · Checklist mid-completion — some Kitchen items checked, others still open. Not a bulk-complete state.
- `video-3-a-day-in-the-field/video3-before-after-photos.png` — Video 3 · Before/after photo capture — the field upload screen for proof-of-work photos.
- `video-3-a-day-in-the-field/video3-mark-complete.png` — Video 3 · Mark complete — the contractor has checked in and can send the job to the office.
- `video-5-when-something-goes-wrong/video5-flag-issue-action.png` — Video 5 · Flag an issue from the job screen. Demo data only — this is not a real QC case.
- `video-5-when-something-goes-wrong/video5-office-notified.png` — Video 5 · Confirmation — the office has been notified. Demo incident text only; no real QC case content.

