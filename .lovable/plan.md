

# Deduplicate Customer Search Results

## Problem

The customer search in `useCustomerSearch` (`src/hooks/use-sales-data.ts`) deduplicates only by email. This means:
- A person who appears in both `bookings` and `customers` with different email casing could show twice (already handled via `.toLowerCase()`)
- A person with the **same phone number** but different emails shows as separate entries
- A person with the **same name** but different emails shows as separate entries
- Multiple booking rows for the same person are aggregated, but customer/cart duplicates of the same person (matching by phone) slip through

The cleaner search (`CleanerMultiSelect`) is already fine -- it works from a single `cleaners` table with unique `id` keys, so no duplicates are possible.

## Fix

Update the deduplication logic in `useCustomerSearch` to key by **email OR phone**, whichever matches first. This catches cases where the same person has different emails across tables but the same phone number.

## Technical Details

### File: `src/hooks/use-sales-data.ts`

**Change the dedup key logic** in the `useCustomerSearch` queryFn:

- Instead of keying only by `email.toLowerCase()`, generate a composite dedup approach:
  1. Maintain two lookup maps: one by email, one by phone (digits only)
  2. When processing each result, check if **either** the email or phone already exists in the seen maps
  3. If a match is found on either, skip the entry (or merge booking count if from bookings)
  4. If no match, add the entry and register both its email and phone in the lookup maps

**Before (current):**
```typescript
const seen = new Map<string, CustomerSearchResult>();
// ...
const key = b.email.toLowerCase();
if (!seen.has(key)) { seen.set(key, ...); }
```

**After:**
```typescript
const byEmail = new Map<string, CustomerSearchResult>();
const byPhone = new Map<string, CustomerSearchResult>();

function findExisting(email: string, phone: string) {
  return byEmail.get(email.toLowerCase()) 
    || (phone ? byPhone.get(phone.replace(/\D/g, '')) : undefined);
}

function register(result: CustomerSearchResult) {
  if (result.email) byEmail.set(result.email.toLowerCase(), result);
  const digits = result.phone?.replace(/\D/g, '');
  if (digits && digits.length >= 10) byPhone.set(digits, result);
}
```

This ensures that if "John Doe" appears in `customers` with email A and phone 555-1234, and again in `bookings` with email B but the same phone 555-1234, only one entry shows up.

### No other files change

The `CleanerMultiSelect` component queries a single table with unique IDs -- no dedup needed there.

