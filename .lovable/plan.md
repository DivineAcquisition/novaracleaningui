

# Complete Admin Portal Build-Out

## What's Missing Today

The admin portal currently has isolated pages (Cleaners, Directory, Dispatch, Intake, Webhooks) but lacks:
- A unified layout with sidebar navigation
- A Bookings Management page (view/search/edit/cancel all booked jobs)
- A Customers Management page (view all customer accounts, booking history, membership status)
- An Admin Dashboard home page with key metrics at a glance

## Plan

### 1. Admin Layout with Sidebar Navigation
Create a shared `AdminLayout` component that wraps all admin pages with:
- Collapsible sidebar with navigation links (Dashboard, Bookings, Customers, Cleaners, Directory, Dispatch, Intake, Webhooks)
- Current page indicator
- Admin user info + sign-out button in the sidebar footer
- Mobile-responsive (drawer on small screens)

### 2. Admin Dashboard Page (`/admin` or `/admin/dashboard`)
A summary page showing:
- Today's bookings count, upcoming bookings, revenue this month
- Quick stats: total customers, active cleaners, pending jobs
- Recent bookings list (last 10)
- Alerts: unassigned jobs, failed webhooks, pending cleaner approvals

### 3. Bookings Management Page (`/admin/bookings`)
Full CRUD for all bookings:
- Searchable/filterable table (by status, date range, customer email, cleaner)
- Status filters: All, Pending Payment, Confirmed, Assigned, Completed, Cancelled
- Each row shows: date, customer name, address, service type, status, assigned cleaner(s), amount
- Click a row to open a detail/edit panel:
  - View full booking details
  - Change status
  - Reassign cleaner
  - Add/edit team notes, dispatch notes
  - Cancel booking (with reason)
  - View payment info (Stripe link)

### 4. Customers Management Page (`/admin/customers`)
Full view of all customer accounts:
- Searchable table (by name, email, phone, ZIP)
- Each row: name, email, phone, ZIP, booking count, membership status, referral code
- Click to expand: booking history, membership credit details, referral activity
- Quick actions: view bookings for this customer

### 5. Route Updates
Add new routes in `App.tsx`:
- `/admin/dashboard` -- Admin Dashboard (default after login)
- `/admin/bookings` -- Bookings Management
- `/admin/customers` -- Customers Management
- Update AdminAuth to redirect to `/admin/dashboard` instead of `/admin/dispatch`

## Technical Details

### New Files
| File | Purpose |
|---|---|
| `src/components/admin/AdminLayout.tsx` | Shared sidebar layout wrapping all admin pages |
| `src/pages/admin/Dashboard.tsx` | Admin home with KPI cards and alerts |
| `src/pages/admin/Bookings.tsx` | Bookings table with search, filter, detail panel |
| `src/pages/admin/Customers.tsx` | Customers table with search, expansion rows |

### Modified Files
| File | Change |
|---|---|
| `src/App.tsx` | Add 3 new admin routes, wrap existing admin routes in AdminLayout |
| `src/pages/admin/Auth.tsx` | Redirect to `/admin/dashboard` on success |
| All existing admin pages | Wrap in AdminLayout for consistent navigation |

### Data Sources (no schema changes needed)
- **Bookings**: `bookings` table -- already has public read/update RLS
- **Customers**: `customers` table -- already has public read RLS
- **Cleaners**: `cleaners` table -- admin RLS via `has_role`
- **Jobs/Assignments**: `jobs`, `job_assignments` tables -- admin RLS
- **Membership**: `membership_credits` table -- public read RLS
- **Payouts**: `payouts` table -- admin RLS

### No database migrations required
All tables already exist with appropriate columns and RLS policies for admin access.

### Bookings Detail Panel Fields
- Customer info (name, email, phone)
- Service details (type, home size, add-ons, frequency)
- Address, date, time slot, arrival window
- Status with dropdown to change
- Assigned cleaners with reassignment option
- Payment: method, option (deposit/full), amounts, Stripe invoice link
- Notes: access, team, dispatch (editable)
- Cancel button with reason dialog
- Check-in/out times, before/after photos (read-only)

