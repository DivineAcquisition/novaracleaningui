

# Activate All Maryland ZIP Codes in Service Area

## What's Happening Now

The `service_coverage_zones` database table already contains **301 Maryland ZIP codes** with city names and tier classifications. However, only **12 are active** (the Bethesda ZIP codes). The remaining 289 are set to `is_active = false`, which causes the booking flow to redirect customers to the waitlist.

## The Fix

Run a single SQL update to set `is_active = true` for all Maryland ZIP codes:

```sql
UPDATE service_coverage_zones
SET is_active = true
WHERE state = 'MD' AND is_active = false;
```

This will activate all 289 currently inactive Maryland ZIP codes. No code changes are needed -- the booking flow (`src/pages/book/Zip.tsx`) already queries `service_coverage_zones` with `eq('is_active', true)`, so all Maryland ZIPs will immediately start working.

## What Changes

- **Before**: Only 12 Bethesda ZIP codes accepted; all other MD ZIPs go to waitlist
- **After**: All 301 Maryland ZIP codes accepted in the booking flow

## Files Changed

No file changes needed. This is a database-only update.
