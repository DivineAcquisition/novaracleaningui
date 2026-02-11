import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from "react-router-dom";
import { BookingProvider } from "@/contexts/BookingContext";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import Demo from "./pages/Demo";
import Auth from "./pages/Auth";
import Account from "./pages/Account";
import Membership from "./pages/Membership";
import ResetPassword from "./pages/ResetPassword";
import UpdatePassword from "./pages/UpdatePassword";
import AuthCallback from "./pages/AuthCallback";
import BookingZip from "./pages/book/Zip";
import BookingHome from "./pages/book/Home";
import BookingOffer from "./pages/book/Offer";
import BookingCheckout from "./pages/book/Checkout";
import PropertyDetails from "./pages/book/PropertyDetails";
import BookingSuccess from "./pages/book/Success";
import CustomQuote from "./pages/book/CustomQuote";
import NotFound from "./pages/NotFound";
import AdminCleaners from "./pages/admin/Cleaners";
import AdminWebhooks from "./pages/admin/WebhookMonitor";
import WebhookTester from "./pages/admin/WebhookTester";
import DispatchQueue from "./pages/admin/DispatchQueue";
import CleanerDirectory from "./pages/admin/CleanerDirectory";
import BookingIntake from "./pages/admin/BookingIntake";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminBookings from "./pages/admin/Bookings";
import AdminCustomers from "./pages/admin/Customers";
import CleanerAuth from "./pages/cleaner/Auth";
import CleanerAuthCallback from "./pages/cleaner/AuthCallback";
import CleanerResetPassword from "./pages/cleaner/ResetPassword";
import CleanerOnboarding from "./pages/cleaner/Onboarding";
import CleanerDashboard from "./pages/cleaner/Dashboard";
import CleanerOnboardingPortal from "./pages/cleaner/OnboardingPortal";
import PricingSheet from "./pages/PricingSheet";
import SmsConsent from "./pages/SmsConsent";
import MemberBooking from "./pages/portal/MemberBooking";
import AdminAuth from "./pages/admin/Auth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { DomainRestricted } from "./components/auth/DomainRestricted";
import { DomainRouter } from "./components/auth/DomainRouter";

// Allowed domains for each portal
const BOOKING_ALLOWED_DOMAINS = ['try.novaracleaning.com'];
const APP_ALLOWED_DOMAINS = ['app.novaracleaning.com'];
const ADMIN_ALLOWED_DOMAINS = ['admin.novaracleaning.com'];
const CONTRACTOR_ALLOWED_DOMAINS = ['contractor.novaracleaning.com'];

// Redirect component that preserves search params
function RedirectWithParams({ to }: { to: string }) {
  const [searchParams] = useSearchParams();
  const search = searchParams.toString();
  const destination = search ? `${to}?${search}` : to;
  return <Navigate to={destination} replace />;
}

const queryClient = new QueryClient();


const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <BookingProvider>
            <DomainRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/demo" element={<Demo />} />
              <Route path="/auth" element={
                <DomainRestricted allowedDomains={APP_ALLOWED_DOMAINS} redirectTo="/">
                  <Auth />
                </DomainRestricted>
              } />
              <Route path="/account" element={
                <DomainRestricted allowedDomains={APP_ALLOWED_DOMAINS} redirectTo="/">
                  <Account />
                </DomainRestricted>
              } />
              <Route path="/membership" element={
                <DomainRestricted allowedDomains={APP_ALLOWED_DOMAINS} redirectTo="/">
                  <Membership />
                </DomainRestricted>
              } />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/update-password" element={<UpdatePassword />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              
              {/* Public booking flow - ONLY accessible from try.novaracleaning.com */}
              <Route path="/book/zip" element={
                <DomainRestricted 
                  allowedDomains={BOOKING_ALLOWED_DOMAINS}
                  fallbackMessage="The booking flow is only available on try.novaracleaning.com"
                >
                  <BookingZip />
                </DomainRestricted>
              } />
              <Route path="/book/sqft" element={
                <DomainRestricted allowedDomains={BOOKING_ALLOWED_DOMAINS}>
                  <BookingHome />
                </DomainRestricted>
              } />
              <Route path="/book/offer" element={
                <DomainRestricted allowedDomains={BOOKING_ALLOWED_DOMAINS}>
                  <BookingOffer />
                </DomainRestricted>
              } />
              <Route path="/book/checkout" element={
                <DomainRestricted allowedDomains={BOOKING_ALLOWED_DOMAINS}>
                  <BookingCheckout />
                </DomainRestricted>
              } />
              <Route path="/book/details" element={
                <DomainRestricted allowedDomains={BOOKING_ALLOWED_DOMAINS}>
                  <PropertyDetails />
                </DomainRestricted>
              } />
              <Route path="/book/confirmation" element={
                <DomainRestricted allowedDomains={BOOKING_ALLOWED_DOMAINS}>
                  <BookingSuccess />
                </DomainRestricted>
              } />
              
              {/* Legacy redirects for backwards compatibility - preserve search params */}
              <Route path="/book/home" element={<RedirectWithParams to="/book/sqft" />} />
              <Route path="/book/service" element={<RedirectWithParams to="/book/offer" />} />
              <Route path="/book/schedule" element={<RedirectWithParams to="/book/checkout" />} />
              <Route path="/book/summary" element={<RedirectWithParams to="/book/checkout" />} />
              <Route path="/book/success" element={<RedirectWithParams to="/book/confirmation" />} />
              <Route path="/book/additional-details" element={<RedirectWithParams to="/book/details" />} />
              
              <Route path="/book/custom-quote" element={
                <DomainRestricted allowedDomains={BOOKING_ALLOWED_DOMAINS}>
                  <CustomQuote />
                </DomainRestricted>
              } />
              <Route path="/admin/auth" element={
                <DomainRestricted allowedDomains={ADMIN_ALLOWED_DOMAINS} redirectTo="/">
                  <AdminAuth />
                </DomainRestricted>
              } />
              <Route path="/admin/dashboard" element={
                <DomainRestricted allowedDomains={ADMIN_ALLOWED_DOMAINS} redirectTo="/">
                  <ProtectedRoute requiredRole="admin"><AdminDashboard /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/bookings" element={
                <DomainRestricted allowedDomains={ADMIN_ALLOWED_DOMAINS} redirectTo="/">
                  <ProtectedRoute requiredRole="admin"><AdminBookings /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/customers" element={
                <DomainRestricted allowedDomains={ADMIN_ALLOWED_DOMAINS} redirectTo="/">
                  <ProtectedRoute requiredRole="admin"><AdminCustomers /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/cleaners" element={
                <DomainRestricted allowedDomains={ADMIN_ALLOWED_DOMAINS} redirectTo="/">
                  <ProtectedRoute requiredRole="admin"><AdminCleaners /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/webhooks" element={
                <DomainRestricted allowedDomains={ADMIN_ALLOWED_DOMAINS} redirectTo="/">
                  <ProtectedRoute requiredRole="admin"><AdminWebhooks /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/webhook-tester" element={
                <DomainRestricted allowedDomains={ADMIN_ALLOWED_DOMAINS} redirectTo="/">
                  <ProtectedRoute requiredRole="admin"><WebhookTester /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/dispatch" element={
                <DomainRestricted allowedDomains={ADMIN_ALLOWED_DOMAINS} redirectTo="/">
                  <ProtectedRoute requiredRole="admin"><DispatchQueue /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/directory" element={
                <DomainRestricted allowedDomains={ADMIN_ALLOWED_DOMAINS} redirectTo="/">
                  <ProtectedRoute requiredRole="admin"><CleanerDirectory /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/intake" element={
                <DomainRestricted allowedDomains={ADMIN_ALLOWED_DOMAINS} redirectTo="/">
                  <ProtectedRoute requiredRole="admin"><BookingIntake /></ProtectedRoute>
                </DomainRestricted>
              } />
              {/* Cleaner Portal - Domain restricted to contractor subdomain */}
              <Route path="/cleaner/auth" element={
                <DomainRestricted allowedDomains={CONTRACTOR_ALLOWED_DOMAINS} redirectTo="/">
                  <CleanerAuth />
                </DomainRestricted>
              } />
              <Route path="/cleaner/auth/callback" element={
                <DomainRestricted allowedDomains={CONTRACTOR_ALLOWED_DOMAINS} redirectTo="/">
                  <CleanerAuthCallback />
                </DomainRestricted>
              } />
              <Route path="/cleaner/reset-password" element={
                <DomainRestricted allowedDomains={CONTRACTOR_ALLOWED_DOMAINS} redirectTo="/">
                  <CleanerResetPassword />
                </DomainRestricted>
              } />
              <Route path="/cleaner/onboarding" element={
                <DomainRestricted allowedDomains={CONTRACTOR_ALLOWED_DOMAINS} redirectTo="/">
                  <CleanerOnboarding />
                </DomainRestricted>
              } />
              <Route path="/cleaner/dashboard" element={
                <DomainRestricted allowedDomains={CONTRACTOR_ALLOWED_DOMAINS} redirectTo="/">
                  <CleanerDashboard />
                </DomainRestricted>
              } />
              <Route path="/cleaner/ob-portal" element={
                <DomainRestricted allowedDomains={CONTRACTOR_ALLOWED_DOMAINS} redirectTo="/">
                  <CleanerOnboardingPortal />
                </DomainRestricted>
              } />
              {/* Alias for contractor.novaracleaning.com/ob-portal */}
              <Route path="/ob-portal" element={
                <DomainRestricted allowedDomains={CONTRACTOR_ALLOWED_DOMAINS} redirectTo="/">
                  <CleanerOnboardingPortal />
                </DomainRestricted>
              } />
              {/* Legacy routes redirect to dashboard */}
              <Route path="/cleaner/profile" element={<Navigate to="/cleaner/dashboard" replace />} />
              <Route path="/cleaner/onboarding-landing" element={<Navigate to="/cleaner/onboarding" replace />} />
              <Route path="/cleaner/onboard" element={<Navigate to="/cleaner/onboarding" replace />} />
              <Route path="/pricing-sheet" element={<PricingSheet />} />
              <Route path="/pricing" element={<PricingSheet />} />
              <Route path="/sms-consent" element={<SmsConsent />} />
              
              {/* Customer Portal - Member Booking */}
              <Route path="/portal/book" element={<MemberBooking />} />
              
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </DomainRouter>
          </BookingProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
