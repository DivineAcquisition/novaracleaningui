-- ─── Focused clean per-area checklists ───────────────────────────────────
-- section_meta holds per-area before/after photos + conditions-found notes.
-- Checklists live in app_settings.focused_same_day_settings.checklists so
-- ops can edit items / add area types without a code deploy.

ALTER TABLE public.job_checklists
  ADD COLUMN IF NOT EXISTS section_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.job_checklists.section_meta IS
  'Focused (and future) per-section meta: { "0": { before:[], after:[], conditions_note, conditions_photos:[] } }.';

-- Merge full per-area checklist content into focused_same_day_settings.
UPDATE public.app_settings
SET
  value = COALESCE(value, '{}'::jsonb) || jsonb_build_object(
    'checklists',
    '{
      "bathroom": [
        "Toilet — bowl, seat (both sides), tank, base, behind",
        "Shower/tub — walls, door or curtain rod, fixtures, drain, soap scum removed",
        "Sink, faucet, countertop, backsplash",
        "Mirror and glass",
        "Vanity exterior, cabinet fronts, handles",
        "Towel bars, paper holder, light switches, door handles",
        "Trash emptied, liner replaced",
        "Baseboards",
        "Floor vacuumed and mopped — corners and behind the toilet included"
      ],
      "kitchen": [
        "Countertops cleared, wiped, items returned",
        "Backsplash",
        "Sink, faucet, drain, disposal splash guard",
        "Stovetop, grates, control knobs, hood/vent exterior",
        "Appliance exteriors — fridge, oven, dishwasher, microwave",
        "Microwave interior",
        "Cabinet fronts and handles",
        "Small appliance exteriors",
        "Table and chairs (if present)",
        "Trash emptied, liner replaced, can wiped",
        "Baseboards",
        "Floor vacuumed and mopped — including the toe-kick edge"
      ],
      "bedroom": [
        "Bed made, or linens changed if provided",
        "Surfaces dusted — nightstands, dresser, headboard, shelves, lamps",
        "Mirrors and glass",
        "Under-bed floor cleaned where accessible",
        "Window sills, ledges, blinds dusted",
        "Light switches, door handles, baseboards",
        "Trash emptied",
        "Floor vacuumed; mopped if hard surface"
      ],
      "living": [
        "Surfaces dusted — tables, shelves, entertainment center, decor",
        "Electronics dusted (screens with appropriate cloth)",
        "Upholstered furniture vacuumed, cushions straightened and lifted",
        "Mirrors and glass",
        "Window sills, ledges, blinds",
        "Light switches, door handles, baseboards",
        "Trash emptied",
        "Floor vacuumed and mopped, including under reachable furniture"
      ],
      "other": [
        "Surfaces dusted",
        "Glass / mirrors cleaned",
        "Fixtures and light switches wiped",
        "Baseboards",
        "Trash emptied",
        "Floor vacuumed and mopped"
      ]
    }'::jsonb
  ),
  updated_at = now()
WHERE key = 'focused_same_day_settings';
