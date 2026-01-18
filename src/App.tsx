import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { BookingProvider } from "@/contexts/BookingContext";
import { AuthProvider } from "@/contexts/AuthContext";

// Page imports
import Index from "./pages/Index";
import Demo from "./pages/Demo";
import PricingLanding from "./pages/PricingLanding";
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
import SmsConsent from "./pages/SmsConsent";

// Admin pages
import AdminAuth from "./pages/admin/Auth";
import AdminCleaners from "./pages/admin/Cleaners";
import AdminWebhooks from "./pages/admin/WebhookMonitor";
import WebhookTester from "./pages/admin/WebhookTester";
import DispatchQueue from "./pages/admin/DispatchQueue";
import CleanerDirectory from "./pages/admin/CleanerDirectory";
import BookingIntake from "./pages/admin/BookingIntake";

// Contractor/Cleaner pages
import ContractorLanding from "./pages/contractor/Landing";
import CleanerAuth from "./pages/cleaner/Auth";
import CleanerResetPassword from "./pages/cleaner/ResetPassword";
import CleanerProfile from "./pages/cleaner/Profile";
import CleanerOnboarding from "./pages/cleaner/Onboarding";
import OnboardingLanding from "./pages/cleaner/OnboardingLanding";
import CleanerDashboard from "./pages/cleaner/Dashboard";
import CleanerAvailability from "./pages/cleaner/Availability";
import MobileDashboard from "./pages/cleaner/MobileDashboard";
import MobileJobOffers from "./pages/cleaner/MobileJobOffers";

import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminProtectedRoute } from "./components/AdminProtectedRoute";

const queryClient = new QueryClient();

// Domain detection utility
type DomainType = "contractor" | "admin" | "booking" | "landing" | "main";

function getCurrentDomain(): DomainType {
  const hostname = window.location.hostname;
  
  if (hostname.startsWith("contractor.") || hostname.includes("contractor")) {
    return "contractor";
  }
  if (hostname.startsWith("admin.") || hostname.includes("admin")) {
    return "admin";
  }
  if (hostname.startsWith("try.") || hostname.includes("try")) {
    return "landing";
  }
  if (hostname.startsWith("book.") || hostname.includes("book")) {
    return "booking";
  }
  
  // Default for localhost or main domain
  return "main";
}

// Domain-aware home component
function DomainAwareHome() {
  const domain = getCurrentDomain();
  
  switch (domain) {
    case "contractor":
      return <ContractorLanding />;
    case "admin":
      return <Navigate to="/admin/auth" replace />;
    case "landing":
      return <PricingLanding />;
    default:
      return <Index />;
  }
}

// Contractor Routes Component
function ContractorRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ContractorLanding />} />
      <Route path="/cleaner/auth" element={<CleanerAuth />} />
      <Route path="/cleaner/reset-password" element={<CleanerResetPassword />} />
      <Route path="/cleaner/dashboard" element={<CleanerDashboard />} />
      <Route path="/cleaner/mobile-dashboard" element={<MobileDashboard />} />
      <Route path="/cleaner/job-offers" element={<MobileJobOffers />} />
      <Route path="/cleaner/availability" element={<CleanerAvailability />} />
      <Route path="/cleaner/profile" element={<CleanerProfile />} />
      <Route path="/cleaner/onboarding-landing" element={<OnboardingLanding />} />
      <Route path="/cleaner/onboard" element={<OnboardingLanding />} />
      <Route path="/cleaner/onboarding" element={<CleanerOnboarding />} />
      
      {/* Allow booking flow access from contractor domain */}
      <Route path="/book/zip" element={<BookingZip />} />
      <Route path="/book/sqft" element={<BookingHome />} />
      <Route path="/book/offer" element={<BookingOffer />} />
      <Route path="/book/checkout" element={<BookingCheckout />} />
      <Route path="/book/details" element={<PropertyDetails />} />
      <Route path="/book/confirmation" element={<BookingSuccess />} />
      
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="*" element={<ContractorLanding />} />
    </Routes>
  );
}

// Admin Routes Component
function AdminRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin/auth" replace />} />
      <Route path="/admin/auth" element={<AdminAuth />} />
      <Route path="/admin/cleaners" element={<AdminProtectedRoute><AdminCleaners /></AdminProtectedRoute>} />
      <Route path="/admin/webhooks" element={<AdminProtectedRoute><AdminWebhooks /></AdminProtectedRoute>} />
      <Route path="/admin/webhook-tester" element={<AdminProtectedRoute><WebhookTester /></AdminProtectedRoute>} />
      <Route path="/admin/dispatch" element={<AdminProtectedRoute><DispatchQueue /></AdminProtectedRoute>} />
      <Route path="/admin/directory" element={<AdminProtectedRoute><CleanerDirectory /></AdminProtectedRoute>} />
      <Route path="/admin/intake" element={<AdminProtectedRoute><BookingIntake /></AdminProtectedRoute>} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="*" element={<Navigate to="/admin/auth" replace />} />
    </Routes>
  );
}

// Landing Page Routes (try.novaracleaning.com)
function LandingRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PricingLanding />} />
      <Route path="/price" element={<PricingLanding />} />
      <Route path="/pricing" element={<PricingLanding />} />
      
      {/* Allow booking flow access */}
      <Route path="/book/zip" element={<BookingZip />} />
      <Route path="/book/sqft" element={<BookingHome />} />
      <Route path="/book/offer" element={<BookingOffer />} />
      <Route path="/book/checkout" element={<BookingCheckout />} />
      <Route path="/book/details" element={<PropertyDetails />} />
      <Route path="/book/confirmation" element={<BookingSuccess />} />
      
      <Route path="/auth" element={<Auth />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="*" element={<PricingLanding />} />
    </Routes>
  );
}

// Main/Booking Routes (book.novaracleaning.com or default)
function MainRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DomainAwareHome />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/price" element={<PricingLanding />} />
      <Route path="/pricing" element={<PricingLanding />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/account" element={<Account />} />
      <Route path="/membership" element={<Membership />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/update-password" element={<UpdatePassword />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      
      {/* Booking flow */}
      <Route path="/book/zip" element={<BookingZip />} />
      <Route path="/book/sqft" element={<BookingHome />} />
      <Route path="/book/offer" element={<BookingOffer />} />
      <Route path="/book/checkout" element={<BookingCheckout />} />
      <Route path="/book/details" element={<PropertyDetails />} />
      <Route path="/book/confirmation" element={<BookingSuccess />} />
      
      {/* Legacy redirects */}
      <Route path="/book/home" element={<Navigate to="/book/sqft" replace />} />
      <Route path="/book/service" element={<Navigate to="/book/offer" replace />} />
      <Route path="/book/schedule" element={<Navigate to="/book/checkout" replace />} />
      <Route path="/book/summary" element={<Navigate to="/book/checkout" replace />} />
      <Route path="/book/success" element={<Navigate to="/book/confirmation" replace />} />
      <Route path="/book/additional-details" element={<Navigate to="/book/details" replace />} />
      
      <Route path="/book/custom-quote" element={<CustomQuote />} />
      
      {/* Admin routes (with protection) */}
      <Route path="/admin/auth" element={<AdminAuth />} />
      <Route path="/admin/cleaners" element={<ProtectedRoute requiredRole="admin"><AdminCleaners /></ProtectedRoute>} />
      <Route path="/admin/webhooks" element={<ProtectedRoute requiredRole="admin"><AdminWebhooks /></ProtectedRoute>} />
      <Route path="/admin/webhook-tester" element={<ProtectedRoute requiredRole="admin"><WebhookTester /></ProtectedRoute>} />
      <Route path="/admin/dispatch" element={<ProtectedRoute requiredRole="admin"><DispatchQueue /></ProtectedRoute>} />
      <Route path="/admin/directory" element={<ProtectedRoute requiredRole="admin"><CleanerDirectory /></ProtectedRoute>} />
      <Route path="/admin/intake" element={<BookingIntake />} />
      
      {/* Cleaner routes */}
      <Route path="/cleaner/auth" element={<CleanerAuth />} />
      <Route path="/cleaner/reset-password" element={<CleanerResetPassword />} />
      <Route path="/cleaner/dashboard" element={<CleanerDashboard />} />
      <Route path="/cleaner/mobile-dashboard" element={<MobileDashboard />} />
      <Route path="/cleaner/job-offers" element={<MobileJobOffers />} />
      <Route path="/cleaner/availability" element={<CleanerAvailability />} />
      <Route path="/cleaner/profile" element={<CleanerProfile />} />
      <Route path="/cleaner/onboarding-landing" element={<OnboardingLanding />} />
      <Route path="/cleaner/onboard" element={<OnboardingLanding />} />
      <Route path="/cleaner/onboarding" element={<CleanerOnboarding />} />
      
      <Route path="/sms-consent" element={<SmsConsent />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

// Domain Router Component
function DomainRouter() {
  const domain = getCurrentDomain();
  
  switch (domain) {
    case "contractor":
      return <ContractorRoutes />;
    case "admin":
      return <AdminRoutes />;
    case "landing":
      return <LandingRoutes />;
    default:
      return <MainRoutes />;
  }
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <BookingProvider>
            <DomainRouter />
          </BookingProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
