

# Fix Black Page -- Apply Novara Branding to Sales & Intake Backgrounds

## Problem

The Sales & Intake page still uses a near-black color scheme (`bg-slate-950` page, `bg-slate-900` cards, `border-slate-800` borders). The Novara green was only applied to buttons and the logo, not to the overall page background and card styling.

## Fix

Replace the dark slate background with a light/white theme that matches the Novara brand:

- **Page background**: Change from `bg-slate-950` to `bg-gray-50` (light gray)
- **Cards**: Change from `bg-slate-900 border-slate-800` to `bg-white border-gray-200`
- **Header bar**: Change from `bg-slate-900/50` to `bg-white border-gray-200`
- **Text colors**: Change from `text-white` to `text-gray-900`, `text-slate-300` to `text-gray-600`, `text-slate-400` to `text-gray-500`
- **Inputs**: Change from `bg-slate-800 border-slate-700 text-white` to `bg-white border-gray-300 text-gray-900`
- **PIN gate**: Same treatment -- light background with green accents
- **Search popover**: Light background instead of dark
- **Tab styling**: Light background tabs with green active indicator

## Scope

Only one file changes: `src/pages/admin/SalesTool.tsx`

Every instance of the dark slate classes gets replaced with light equivalents. All green brand accents (buttons, badges, highlights) stay the same. The result is a clean, professional white page with Novara green accents -- no more "black page."

## Technical Details

### Class replacements (applied throughout the file)

| Dark class | Light replacement |
|---|---|
| `bg-slate-950` | `bg-gray-50` |
| `bg-slate-900` | `bg-white` |
| `bg-slate-900/50` | `bg-white/90` |
| `bg-slate-800` | `bg-gray-50` or `bg-white` (inputs) |
| `border-slate-800` | `border-gray-200` |
| `border-slate-700` | `border-gray-300` |
| `border-slate-600` | `border-gray-300` |
| `border-white/10` | `border-gray-200` |
| `text-white` | `text-gray-900` |
| `text-slate-300` | `text-gray-600` |
| `text-slate-400` | `text-gray-500` |
| `text-slate-500` | `text-gray-400` |
| `hover:bg-slate-800` | `hover:bg-gray-100` |
| `placeholder:text-slate-500` | `placeholder:text-gray-400` |

### File modified
- `src/pages/admin/SalesTool.tsx` -- All background, card, input, text, and border classes updated from dark slate to light theme

