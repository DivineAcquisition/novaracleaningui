# NovaraCleaning Dual-Domain Apps

This directory contains two separate Next.js applications that connect to the same Supabase backend, providing different booking experiences based on customer awareness.

## Domain Architecture

| Domain | Purpose | Target User |
|--------|---------|-------------|
| try.novaracleaning.com | New customer acquisition | First-time visitors, leads |
| app.novaracleaning.com | Returning customer portal | Existing customers, members |

## Apps Structure

```
apps/
├── try/           # New customer acquisition app
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx              # Landing page with ZIP entry
│   │   │   ├── (booking)/            # Booking flow route group
│   │   │   │   ├── sqft/             # Home size selection
│   │   │   │   ├── offer/            # Service selection + scheduling
│   │   │   │   ├── checkout/         # Payment with Stripe
│   │   │   │   ├── details/          # Property details (post-payment)
│   │   │   │   └── confirmation/     # Success page
│   │   │   └── custom-quote/         # Large home quote form
│   │   └── components/
│   └── package.json
│
└── customer/      # Customer portal app
    ├── src/
    │   ├── app/
    │   │   ├── (auth)/               # Authentication pages
    │   │   │   ├── login/
    │   │   │   ├── signup/
    │   │   │   └── reset-password/
    │   │   └── dashboard/            # Protected dashboard
    │   │       ├── bookings/         # Booking management
    │   │       ├── membership/       # Membership & credits
    │   │       ├── addresses/        # Saved addresses
    │   │       ├── payments/         # Payment history
    │   │       ├── referrals/        # Referral program
    │   │       └── settings/         # Account settings
    │   ├── contexts/                 # Auth context
    │   └── components/
    └── package.json
```

## Technology Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **State Management**: TanStack Query
- **Authentication**: Supabase Auth
- **Payments**: Stripe Elements
- **Database**: Supabase (shared backend)

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

1. Install dependencies for each app:

```bash
cd apps/try && npm install
cd apps/customer && npm install
```

2. Set up environment variables:

Create `.env.local` in each app directory:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=your_stripe_key
NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=your_google_key
```

3. Run development servers:

```bash
# Try app (port 3001)
cd apps/try && npm run dev

# Customer app (port 3002)
cd apps/customer && npm run dev
```

### Building

```bash
# Build try app
cd apps/try && npm run build

# Build customer app
cd apps/customer && npm run build
```

## Deployment

Both apps should be deployed as separate Vercel projects:

### try.novaracleaning.com
1. Create new Vercel project
2. Set root directory to `apps/try`
3. Add custom domain: `try.novaracleaning.com`
4. Configure environment variables

### app.novaracleaning.com
1. Create new Vercel project
2. Set root directory to `apps/customer`
3. Add custom domain: `app.novaracleaning.com`
4. Configure environment variables

## Key Features

### try.novaracleaning.com (New Customers)
- ZIP code validation for service coverage
- Lead capture before payment (webhooks to CRM)
- Promotional pricing (promo codes)
- Two booking options: Deep Clean or Membership
- Stripe payment with deposit option
- Property details collection post-payment
- Referral code generation

### app.novaracleaning.com (Existing Customers)
- Email/password authentication with Supabase
- Dashboard with booking overview
- Membership credit tracking
- Quick booking with saved addresses
- Payment history with Stripe portal link
- Referral program with sharing
- Notification preferences

## Shared Backend

Both apps connect to the same Supabase instance and use shared:
- Database tables (customers, bookings, membership_credits, etc.)
- Edge functions (payment processing, email sending, webhooks)
- Authentication (Supabase Auth)

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key | Yes |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key | Yes (for checkout) |
| `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` | Google Places API key | Optional |
| `NEXT_PUBLIC_APP_URL` | Application URL | Optional |
