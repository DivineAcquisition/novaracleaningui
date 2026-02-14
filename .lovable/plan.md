

# Customer Search + Sales Form Verification — COMPLETED

## ✅ Implemented

### 1. Customer Search (`useCustomerSearch` hook)
- Searches `customers`, `bookings`, and `abandoned_carts` tables simultaneously
- Debounced (300ms), min 2 chars, deduplicates by email
- Results tagged with source badges: "Booked Before" (green), "Customer Record" (blue), "Abandoned Cart" (amber)
- Shows booking count and last date for returning customers

### 2. Search UI in LeadIntakeSection
- Search input at top of Lead Intake with dropdown results
- Clicking a result auto-fills name, email, phone and toggles "Existing Customer" on
- Replaces the old "toggle + exact email" workflow

### 3. City/State auto-fill from ZIP coverage
- `BookingConfirmationSection` accepts `coverageCity` and `coverageState` props
- Auto-fills from `useServiceCoverage` hook data when ZIP is entered in Qualification
- Passed from `SalesTool.tsx`

### 4. Lead status auto-advance
- Copying or emailing a quote updates lead status to "quoted" in the database
- `LiveQuotePanel` accepts `onStatusAdvance` callback for UI notification
