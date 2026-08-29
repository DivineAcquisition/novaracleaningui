# Standard Cleaning Checklists — STR / Airbnb Turnover · Office · Commercial

**Edition 1.0 · 2026 · Internal use only**

Task-level checklists for every visit, built on current industry standards and Novara's own
scope levels — distinct from the walkthrough/assessment checklists used for pricing.

Sourced from current STR, janitorial, and ISSA-aligned commercial cleaning standards (2026).

> This is the **standing baseline**. It is a living document: real job outcomes — QC cases,
> re-cleans, reviews, duration variance — feed back into these checklists through the
> checklist feedback loop (Commercial → Checklists → Review queue). Every change is a human
> decision and is versioned, so a job always reflects the checklist that was current when it
> was performed.

Item IDs in this document are the stable identifiers used by the feedback loop. A QC case, a
re-clean, or a duration-variance record references an item by its ID, so signal survives
rewording. See `src/lib/checklist-catalog.ts`.

---

## Part A — STR / Airbnb Turnover

Cleanliness is the #1 driver of negative reviews on STR platforms. A missed detail here is
discovered by the next guest, not a supervisor.

### Before starting

| ID | Task |
| --- | --- |
| `str.before.deadline` | Confirm checkout time and next check-in time — know the hard deadline |
| `str.before.damage_walk` | Quick walkthrough for damage or missing items — report immediately, don't wait |
| `str.before.trash_collect` | Collect all trash from every room, bathroom, and outdoor area; replace all liners |
| `str.before.strip_linens` | Strip all beds and collect used towels/linens — start laundry immediately if on-site, or bag for pickup |
| `str.before.air_out` | Open windows briefly to air out the space while cleaning, weather permitting |

### Kitchen

| ID | Task |
| --- | --- |
| `str.kitchen.clear_food` | Clear all leftover food and guest items |
| `str.kitchen.stovetop` | Wipe stovetop, burner grates, behind/under knobs |
| `str.kitchen.microwave_interior` | Clean inside microwave (turntable, walls, seal) |
| `str.kitchen.appliance_exteriors` | Wipe exterior of all appliances |
| `str.kitchen.fridge_interior` | Clean inside fridge — remove guest food, wipe shelves |
| `str.kitchen.dishes` | Run dishwasher or hand-wash all dishes |
| `str.kitchen.dishware_check` | Check utensils, glasses, mugs for cleanliness |
| `str.kitchen.counters` | Wipe counters, backsplash, cabinet fronts |
| `str.kitchen.sink` | Clean sink and faucet |
| `str.kitchen.restock` | Restock coffee/tea/paper goods to host spec |
| `str.kitchen.trash_out` | Take out trash and recycling |

### Bathroom(s)

| ID | Task |
| --- | --- |
| `str.bath.toilet` | Clean toilet completely — bowl, seat both sides, base, behind |
| `str.bath.shower` | Clean shower/tub, fixtures, drain |
| `str.bath.sink_mirror` | Clean sink, faucet, counter, mirror |
| `str.bath.restock` | Restock toiletries and toilet paper to host spec |
| `str.bath.towels` | Replace all towels and bath mats |
| `str.bath.trash` | Empty trash, replace liner |
| `str.bath.left_items` | Check for guest-left items in cabinets/drawers |

### Bedroom(s)

| ID | Task |
| --- | --- |
| `str.bed.strip` | Strip all bedding |
| `str.bed.remake` | Remake with fresh linens per host spec |
| `str.bed.dust` | Dust all surfaces — nightstands, dresser, headboard, lamps |
| `str.bed.vacuum` | Vacuum floor, including under bed where accessible |
| `str.bed.left_items` | Check closet and drawers for guest-left items |
| `str.bed.touch_points` | Wipe light switches and door handles |

### Living areas

| ID | Task |
| --- | --- |
| `str.living.floors` | Vacuum and/or mop all floors |
| `str.living.dust` | Dust all surfaces including ceiling fans and remotes |
| `str.living.touch_points` | Wipe light switches and door handles |
| `str.living.staging` | Straighten furniture and decor to staged position |
| `str.living.glass` | Clean any glass/mirrors |

### Entry & outdoor

| ID | Task |
| --- | --- |
| `str.entry.welcome_zone` | Clean entry area, door glass, and welcome zone |
| `str.entry.outdoor_furniture` | Clean outdoor furniture if present |
| `str.entry.ashtrays` | Empty ashtrays if present |
| `str.entry.left_items` | Check for guest-left items outdoors |
| `str.entry.trash_schedule` | Confirm trash/recycling schedule compliance |

### High-touch disinfection — every visit, every property (2026 baseline)

| ID | Task |
| --- | --- |
| `str.touch.door_handles` | Door handles (interior and exterior) |
| `str.touch.light_switches` | Light switches |
| `str.touch.remotes` | Remote controls |
| `str.touch.pulls` | Cabinet and drawer pulls |
| `str.touch.faucets` | Faucet handles |
| `str.touch.flush_handles` | Toilet flush handles |
| `str.touch.railings` | Stair railings |

### Final walkthrough & staging

| ID | Task |
| --- | --- |
| `str.final.test_appliances` | Test appliances (stove, microwave, dishwasher) |
| `str.final.wifi` | Confirm WiFi is working |
| `str.final.access_codes` | Confirm access codes/locks function correctly for the next guest |
| `str.final.spa_reference` | Stage per host's standard property appearance (SPA) reference if one exists |
| `str.final.room_sweep` | Walk every room one final time, top to bottom, left to right |
| `str.final.photos` | Take before/after photos — minimum 8–12 covering kitchen, each bathroom, each bedroom, living area, and any issue found |

### Timing reference — solo cleaner, standard turnover

| Property size | Typical time |
| --- | --- |
| Studio / 1BR | 1.5 – 2.5 hrs |
| 2BR | 2 – 3 hrs |
| 3BR | 3 – 4 hrs |
| 4BR+ | 4+ hrs — consider a 2-person crew |

Same-day turnovers (checkout and check-in the same day) are high-risk — confirm the cleaner
the night before, and have a backup plan per the standing coverage system. A delayed check-in
from a late turnover is one of the most commonly cited STR complaints.

---

## Part B — Office

Organized by frequency, matching how commercial cleaning contracts are structured and priced.

### Daily (every scheduled visit)

| ID | Task |
| --- | --- |
| `office.daily.trash` | Empty all trash and recycling bins; replace liners |
| `office.daily.high_touch` | Disinfect high-touch surfaces: door handles, light switches, elevator buttons, shared phones/keyboards, push bars |
| `office.daily.breakroom` | Wipe down kitchen/breakroom counters, tables, appliance exteriors |
| `office.daily.restrooms` | Clean and restock restrooms — toilets, urinals, sinks, mirrors, soap, paper products |
| `office.daily.vacuum_traffic` | Vacuum high-traffic floor areas |
| `office.daily.entry_glass` | Spot-clean entry glass and reception area |
| `office.daily.common_areas` | Straighten common areas and conference rooms |

### Weekly

| ID | Task |
| --- | --- |
| `office.weekly.floor_care` | Detailed floor care — full vacuum of carpeted areas, mop all hard floors |
| `office.weekly.glass_partitions` | Interior glass and partition cleaning |
| `office.weekly.baseboards_vents` | Dust baseboards and vents |
| `office.weekly.appliance_interiors` | Clean appliance interiors |
| `office.weekly.restroom_scrub` | Deeper restroom scrub, including grout and fixtures |
| `office.weekly.workstations` | Dust individual workstations (per desk policy — see below) |
| `office.weekly.door_glass` | Wipe interior door glass and partitions |

### Monthly

| ID | Task |
| --- | --- |
| `office.monthly.window_detail` | Full interior window detail cleaning |
| `office.monthly.carpet_extraction` | Carpet extraction in high-traffic zones (or coordinate with specialist vendor) |
| `office.monthly.vents_fixtures` | Vent and light fixture dusting |
| `office.monthly.supply_audit` | Supply closet audit — restock, check equipment condition |
| `office.monthly.upholstery` | Upholstery care in common areas |

### Desk policy — confirm at walkthrough, applies every visit

- **Clear-desk sites:** dust and wipe full desk surface.
- **Do-not-touch-papers sites:** dust around items only — never move papers, files, or
  personal items.

### Restricted areas & confidential waste

Confirm out-of-scope areas (server/IT rooms, executive offices, secure storage) before
starting, per walkthrough findings. Service confidential/shredding bins separately from
general trash if in scope.

---

## Part C — Commercial (by scope level)

Baseline tasks by scope level — Light / Standard / Detailed — applied across facility types,
adjusted by walkthrough-specific notes.

### Light scope

| ID | Task |
| --- | --- |
| `commercial.light.floors` | Sweep/vacuum all floors |
| `commercial.light.trash` | Empty all trash and recycling; replace liners |
| `commercial.light.restrooms` | Service restrooms — toilets, sinks, mirrors, restock supplies |
| `commercial.light.entry_glass` | Spot-clean entry glass |
| `commercial.light.high_touch` | Wipe down high-touch surfaces (door handles, light switches, push bars) |

### Standard scope — includes Light, plus:

| ID | Task |
| --- | --- |
| `commercial.standard.mop` | Mop all hard floors |
| `commercial.standard.breakroom` | Clean breakroom/kitchen area — counters, tables, appliance exteriors, sink |
| `commercial.standard.rooms` | Clean individual offices/rooms per the site's room count |
| `commercial.standard.dust_common` | Dust reachable surfaces in common areas |
| `commercial.standard.consumables` | Restock all consumables to par level |

### Detailed scope — includes Standard, plus:

| ID | Task |
| --- | --- |
| `commercial.detailed.grout` | Scrub restroom tile and grout |
| `commercial.detailed.sanitization` | High-touch surface sanitization pass beyond daily wipe-down |
| `commercial.detailed.high_dusting` | Dust vents, light fixtures, and high surfaces |
| `commercial.detailed.glass_partitions` | Interior glass and partition cleaning |
| `commercial.detailed.baseboards` | Baseboard detail cleaning |
| `commercial.detailed.deep_floor_care` | Deep floor care appropriate to floor type (per walkthrough findings) |

### Zone documentation — large sites

For any site large enough to use zone-based proof-of-completion, each zone identified at the
walkthrough gets its own checklist pass and its own before/after photos — never one generic
photo pair representing the whole facility. Follow the zone list established for that site's
Firm Price record.

### Universal commercial rules — every facility type, every visit

| ID | Task |
| --- | --- |
| `commercial.universal.access` | Follow the access/security procedure recorded at walkthrough — badge, alarm, loading dock protocol |
| `commercial.universal.window` | Respect the confirmed service window — don't begin before or run past without notifying the office |
| `commercial.universal.report_beyond_scope` | Report any condition beyond scope immediately (mold, pest, biohazard, structural hazard) — stop and report, don't attempt |
| `commercial.universal.photos` | Before/after photos required, organized by zone/area for larger sites |
| `commercial.universal.crew_lead_signoff` | Crew Lead (if crew of 2+) confirms zone-by-zone completion before the crew leaves |

---

## Notes for all three checklists

**Property-specific notes always override the generic checklist.** Intake or walkthrough notes
("don't touch papers on desks," "host prefers towels rolled not folded," "no chemical cleaners
near turf") take precedence for that property, every time.

**Photo documentation is not optional** on any of the three checklists — it's the evidence that
protects both the cleaner and the company in any dispute.

**When in doubt, stop and ask.** The same standing rule across every checklist in this system.
A five-minute pause costs nothing; guessing wrong on scope, access, or an excluded condition
costs much more.

---

## How this document changes

1. Signals accumulate against an item ID — valid quality-miss re-cleans, scope-confusion
   re-cleans, QC cases, review themes, duration variance, recurrence flags.
2. On the aggregation cycle (default monthly), items crossing the minimum signal threshold
   surface in **Commercial → Checklists → Review** with grounded insights citing their counts.
3. An admin edits, leaves unchanged with a note, or escalates. Nothing is auto-edited.
4. Edits create a new version linked to the insight that prompted them. Jobs keep the version
   that was current when they were performed.
5. Checklist Health shows whether the edit actually moved the numbers.
