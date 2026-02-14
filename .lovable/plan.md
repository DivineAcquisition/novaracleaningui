

# Fix Field Colors & Text Visibility in Sales & Intake Tool

## Problem

The parent page (`SalesTool.tsx`) was updated to a light theme (white/gray backgrounds), but **6 child components** still use dark slate styling (`bg-slate-800`, `border-slate-700`, `text-white`, `text-slate-300`). This causes:
- Dark input fields sitting on white cards
- White text on light backgrounds (invisible)
- Dark dropdowns and search results clashing with the light page

## Files to Update

All 6 sub-components need the same dark-to-light class replacements:

1. **`src/components/sales/LeadIntakeSection.tsx`** -- Customer search, lead source/channel selects, name/phone/email inputs, notes textarea
2. **`src/components/sales/QualificationSection.tsx`** -- Service type cards, property selects, home size buttons, ZIP input, frequency buttons, add-on cards, date/time inputs
3. **`src/components/sales/LiveQuotePanel.tsx`** -- Quote breakdown text, deposit section, copy/email buttons, separators
4. **`src/components/sales/SalesAssistPanel.tsx`** -- Channel tips, closing techniques, objection handling accordion
5. **`src/components/sales/BookingConfirmationSection.tsx`** -- Status buttons, address inputs, payment selects, booking summary, confirm button
6. **`src/components/sales/FollowUpScheduler.tsx`** -- Date/time inputs, channel select, message textarea, schedule button

## Class Replacements (applied across all 6 files)

| Dark class | Light replacement |
|---|---|
| `bg-slate-800` | `bg-white` (inputs) or `bg-gray-50` (sections) |
| `bg-slate-800/50` | `bg-gray-50` |
| `border-slate-700` | `border-gray-300` |
| `border-slate-700/50` | `border-gray-200` |
| `border-slate-600` | `border-gray-300` |
| `text-white` | `text-gray-900` |
| `text-slate-300` | `text-gray-600` |
| `text-slate-400` | `text-gray-500` |
| `text-slate-500` | `text-gray-400` |
| `text-slate-600` | `text-gray-500` |
| `hover:bg-slate-700/50` | `hover:bg-gray-100` |
| `hover:bg-slate-800/50` | `hover:bg-gray-100` |
| `hover:border-slate-600` | `hover:border-gray-400` |
| `hover:text-white` | `hover:text-gray-900` |
| `bg-slate-700` | `bg-gray-200` (badges) |
| `text-amber-400` | Novara green `text-emerald-600` (icon accents) |
| `border-amber-500` | `border-emerald-500` (active selections) |
| `bg-amber-500/10` | `bg-emerald-500/10` (active highlights) |
| `bg-amber-500` | Novara green button style (confirm buttons) |
| `bg-slate-500/20 text-slate-400` | `bg-gray-100 text-gray-500` |
| `Separator bg-slate-700` | `Separator bg-gray-200` |
| `Separator bg-slate-600` | `Separator bg-gray-300` |

## Additional Branding Changes

- Replace amber accent color with Novara green throughout (active states, icons, buttons)
- Update "Confirm Booking" and "Schedule Follow-Up" buttons from `bg-amber-500 text-black` to Novara green with white text
- Keep emerald green for discount/savings indicators (already correct)

## No functional changes

Only CSS class swaps -- no logic, state, or data flow changes.

