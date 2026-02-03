import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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
import CleanerAuth from "./pages/cleaner/Auth";
import CleanerAuthCallback from "./pages/cleaner/AuthCallback";
import CleanerResetPassword from "./pages/cleaner/ResetPassword";
import CleanerOnboarding from "./pages/cleaner/Onboarding";
import CleanerOnboardingLanding from "./pages/cleaner/OnboardingLanding";
import CleanerDashboard from "./pages/cleaner/Dashboard";
import SmsConsent from "./pages/SmsConsent";
import MemberBooking from "./pages/portal/MemberBooking";
import AdminAuth from "./pages/admin/Auth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { DomainRestricted } from "./components/auth/DomainRestricted";
import { DomainRouter } from "./components/auth/DomainRouter";

/**
 * Domain Architecture:
 * - try.novaracleaning.com → Public booking flow ONLY
 * - app.novaracleaning.com → Customer portal ONLY (auth, account, membership, portal/*)
 * - admin.novaracleaning.com → Admin portal ONLY
 * - contractor.novaracleaning.com → Cleaner/contractor portal ONLY
 */

// Domain configurations
const BOOKING_DOMAIN = ['try.novaracleaning.com'];
const CUSTOMER_DOMAIN = ['app.novaracleaning.com'];
const ADMIN_DOMAIN = ['admin.novaracleaning.com'];
const CONTRACTOR_DOMAIN = ['contractor.novaracleaning.com'];

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
              {/* Landing - behavior varies by domain via DomainRouter */}
              <Route path="/" element={<Index />} />
              
              {/* ========================================
                  PUBLIC BOOKING FLOW - try.novaracleaning.com ONLY
                  ======================================== */}
              <Route path="/demo" element={
                <DomainRestricted allowedDomains={BOOKING_DOMAIN} portalType="booking">
                  <Demo />
                </DomainRestricted>
              } />
              <Route path="/book/zip" element={
                <DomainRestricted allowedDomains={BOOKING_DOMAIN} portalType="booking">
                  <BookingZip />
                </DomainRestricted>
              } />
              <Route path="/book/sqft" element={
                <DomainRestricted allowedDomains={BOOKING_DOMAIN} portalType="booking">
                  <BookingHome />
                </DomainRestricted>
              } />
              <Route path="/book/offer" element={
                <DomainRestricted allowedDomains={BOOKING_DOMAIN} portalType="booking">
                  <BookingOffer />
                </DomainRestricted>
              } />
              <Route path="/book/checkout" element={
                <DomainRestricted allowedDomains={BOOKING_DOMAIN} portalType="booking">
                  <BookingCheckout />
                </DomainRestricted>
              } />
              <Route path="/book/details" element={
                <DomainRestricted allowedDomains={BOOKING_DOMAIN} portalType="booking">
                  <PropertyDetails />
                </DomainRestricted>
              } />
              <Route path="/book/confirmation" element={
                <DomainRestricted allowedDomains={BOOKING_DOMAIN} portalType="booking">
                  <BookingSuccess />
                </DomainRestricted>
              } />
              <Route path="/book/custom-quote" element={
                <DomainRestricted allowedDomains={BOOKING_DOMAIN} portalType="booking">
                  <CustomQuote />
                </DomainRestricted>
              } />
              
              {/* Legacy booking redirects */}
              <Route path="/book/home" element={<Navigate to="/book/sqft" replace />} />
              <Route path="/book/service" element={<Navigate to="/book/offer" replace />} />
              <Route path="/book/schedule" element={<Navigate to="/book/checkout" replace />} />
              <Route path="/book/summary" element={<Navigate to="/book/checkout" replace />} />
              <Route path="/book/success" element={<Navigate to="/book/confirmation" replace />} />
              <Route path="/book/additional-details" element={<Navigate to="/book/details" replace />} />

              {/* ========================================
                  CUSTOMER PORTAL - app.novaracleaning.com ONLY
                  ======================================== */}
              <Route path="/auth" element={
                <DomainRestricted allowedDomains={CUSTOMER_DOMAIN} portalType="customer">
                  <Auth />
                </DomainRestricted>
              } />
              <Route path="/auth/callback" element={
                <DomainRestricted allowedDomains={CUSTOMER_DOMAIN} portalType="customer">
                  <AuthCallback />
                </DomainRestricted>
              } />
              <Route path="/account" element={
                <DomainRestricted allowedDomains={CUSTOMER_DOMAIN} portalType="customer">
                  <Account />
                </DomainRestricted>
              } />
              <Route path="/membership" element={
                <DomainRestricted allowedDomains={CUSTOMER_DOMAIN} portalType="customer">
                  <Membership />
                </DomainRestricted>
              } />
              <Route path="/reset-password" element={
                <DomainRestricted allowedDomains={CUSTOMER_DOMAIN} portalType="customer">
                  <ResetPassword />
                </DomainRestricted>
              } />
              <Route path="/update-password" element={
                <DomainRestricted allowedDomains={CUSTOMER_DOMAIN} portalType="customer">
                  <UpdatePassword />
                </DomainRestricted>
              } />
              <Route path="/sms-consent" element={
                <DomainRestricted allowedDomains={CUSTOMER_DOMAIN} portalType="customer">
                  <SmsConsent />
                </DomainRestricted>
              } />
              <Route path="/portal/book" element={
                <DomainRestricted allowedDomains={CUSTOMER_DOMAIN} portalType="customer">
                  <MemberBooking />
                </DomainRestricted>
              } />

              {/* ========================================
                  ADMIN PORTAL - admin.novaracleaning.com ONLY
                  ======================================== */}
              <Route path="/admin/auth" element={
                <DomainRestricted allowedDomains={ADMIN_DOMAIN} portalType="admin">
                  <AdminAuth />
                </DomainRestricted>
              } />
              <Route path="/admin/cleaners" element={
                <DomainRestricted allowedDomains={ADMIN_DOMAIN} portalType="admin">
                  <ProtectedRoute requiredRole="admin"><AdminCleaners /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/webhooks" element={
                <DomainRestricted allowedDomains={ADMIN_DOMAIN} portalType="admin">
                  <ProtectedRoute requiredRole="admin"><AdminWebhooks /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/webhook-tester" element={
                <DomainRestricted allowedDomains={ADMIN_DOMAIN} portalType="admin">
                  <ProtectedRoute requiredRole="admin"><WebhookTester /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/dispatch" element={
                <DomainRestricted allowedDomains={ADMIN_DOMAIN} portalType="admin">
                  <ProtectedRoute requiredRole="admin"><DispatchQueue /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/directory" element={
                <DomainRestricted allowedDomains={ADMIN_DOMAIN} portalType="admin">
                  <ProtectedRoute requiredRole="admin"><CleanerDirectory /></ProtectedRoute>
                </DomainRestricted>
              } />
              <Route path="/admin/intake" element={
                <DomainRestricted allowedDomains={ADMIN_DOMAIN} portalType="admin">
                  <BookingIntake />
                </DomainRestricted>
              } />

              {/* ========================================
                  CONTRACTOR PORTAL - contractor.novaracleaning.com ONLY
                  ======================================== */}
              <Route path="/cleaner" element={
                <DomainRestricted allowedDomains={CONTRACTOR_DOMAIN} portalType="contractor">
                  <CleanerOnboardingLanding />
                </DomainRestricted>
              } />
              <Route path="/cleaner/join" element={
                <DomainRestricted allowedDomains={CONTRACTOR_DOMAIN} portalType="contractor">
                  <CleanerOnboardingLanding />
                </DomainRestricted>
              } />
              <Route path="/cleaner/auth" element={
                <DomainRestricted allowedDomains={CONTRACTOR_DOMAIN} portalType="contractor">
                  <CleanerAuth />
                </DomainRestricted>
              } />
              <Route path="/cleaner/auth/callback" element={
                <DomainRestricted allowedDomains={CONTRACTOR_DOMAIN} portalType="contractor">
                  <CleanerAuthCallback />
                </DomainRestricted>
              } />
              <Route path="/cleaner/reset-password" element={
                <DomainRestricted allowedDomains={CONTRACTOR_DOMAIN} portalType="contractor">
                  <CleanerResetPassword />
                </DomainRestricted>
              } />
              <Route path="/cleaner/onboarding" element={
                <DomainRestricted allowedDomains={CONTRACTOR_DOMAIN} portalType="contractor">
                  <CleanerOnboarding />
                </DomainRestricted>
              } />
              <Route path="/cleaner/dashboard" element={
                <DomainRestricted allowedDomains={CONTRACTOR_DOMAIN} portalType="contractor">
                  <CleanerDashboard />
                </DomainRestricted>
              } />
              
              {/* Legacy cleaner routes */}
              <Route path="/cleaner/profile" element={<Navigate to="/cleaner/dashboard" replace />} />
              <Route path="/cleaner/onboarding-landing" element={<Navigate to="/cleaner" replace />} />
              <Route path="/cleaner/onboard" element={<Navigate to="/cleaner" replace />} />
              
              {/* ========================================
                  CATCH-ALL - 404 Page
                  ======================================== */}
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
