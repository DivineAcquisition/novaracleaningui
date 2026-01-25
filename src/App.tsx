import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { BookingProvider } from "@/contexts/BookingContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { CURRENT_SUBDOMAIN } from "@/lib/subdomain";

// Page imports
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
import CleanerResetPassword from "./pages/cleaner/ResetPassword";
import CleanerProfile from "./pages/cleaner/Profile";
import CleanerOnboarding from "./pages/cleaner/Onboarding";
import OnboardingLanding from "./pages/cleaner/OnboardingLanding";
import CleanerDashboard from "./pages/cleaner/Dashboard";
import CleanerAvailability from "./pages/cleaner/Availability";
import MobileDashboard from "./pages/cleaner/MobileDashboard";
import MobileJobOffers from "./pages/cleaner/MobileJobOffers";
import SmsConsent from "./pages/SmsConsent";
import Hiring from "./pages/Hiring";
import { ProtectedRoute } from "./components/ProtectedRoute";

const queryClient = new QueryClient();

// Admin subdomain routes (admin.novaracleaning.com)
const AdminRoutes = () => (
  <Routes>
    {/* Default route for admin subdomain */}
    <Route path="/" element={<Navigate to="/admin/cleaners" replace />} />
    
    {/* Auth routes */}
    <Route path="/auth" element={<Auth />} />
    <Route path="/auth/callback" element={<AuthCallback />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/update-password" element={<UpdatePassword />} />
    
    {/* Admin routes */}
    <Route path="/admin/cleaners" element={<ProtectedRoute requiredRole="admin"><AdminCleaners /></ProtectedRoute>} />
    <Route path="/admin/webhooks" element={<ProtectedRoute requiredRole="admin"><AdminWebhooks /></ProtectedRoute>} />
    <Route path="/admin/webhook-tester" element={<ProtectedRoute requiredRole="admin"><WebhookTester /></ProtectedRoute>} />
    <Route path="/admin/dispatch" element={<ProtectedRoute requiredRole="admin"><DispatchQueue /></ProtectedRoute>} />
    <Route path="/admin/directory" element={<ProtectedRoute requiredRole="admin"><CleanerDirectory /></ProtectedRoute>} />
    <Route path="/admin/intake" element={<BookingIntake />} />
    
    {/* Redirect legacy paths */}
    <Route path="/cleaners" element={<Navigate to="/admin/cleaners" replace />} />
    <Route path="/webhooks" element={<Navigate to="/admin/webhooks" replace />} />
    <Route path="/dispatch" element={<Navigate to="/admin/dispatch" replace />} />
    <Route path="/directory" element={<Navigate to="/admin/directory" replace />} />
    <Route path="/intake" element={<Navigate to="/admin/intake" replace />} />
    
    <Route path="*" element={<NotFound />} />
  </Routes>
);

// Contractor subdomain routes (contractor.novaracleaning.com)
const ContractorRoutes = () => (
  <Routes>
    {/* Default route - cleaner auth */}
    <Route path="/" element={<CleanerAuth />} />
    
    {/* Hiring/Apply routes */}
    <Route path="/hiring" element={<OnboardingLanding />} />
    <Route path="/careers" element={<OnboardingLanding />} />
    <Route path="/join" element={<OnboardingLanding />} />
    <Route path="/apply" element={<OnboardingLanding />} />
    
    {/* Auth routes */}
    <Route path="/auth" element={<CleanerAuth />} />
    <Route path="/reset-password" element={<CleanerResetPassword />} />
    <Route path="/auth/callback" element={<AuthCallback />} />
    
    {/* Cleaner portal routes */}
    <Route path="/dashboard" element={<CleanerDashboard />} />
    <Route path="/mobile-dashboard" element={<MobileDashboard />} />
    <Route path="/job-offers" element={<MobileJobOffers />} />
    <Route path="/availability" element={<CleanerAvailability />} />
    <Route path="/profile" element={<CleanerProfile />} />
    <Route path="/onboarding-landing" element={<OnboardingLanding />} />
    <Route path="/onboard" element={<OnboardingLanding />} />
    <Route path="/onboarding" element={<CleanerOnboarding />} />
    
    {/* Legacy cleaner/* paths redirect */}
    <Route path="/cleaner/auth" element={<Navigate to="/auth" replace />} />
    <Route path="/cleaner/dashboard" element={<Navigate to="/dashboard" replace />} />
    <Route path="/cleaner/profile" element={<Navigate to="/profile" replace />} />
    <Route path="/cleaner/onboarding" element={<Navigate to="/onboarding" replace />} />
    <Route path="/cleaner/*" element={<Navigate to="/" replace />} />
    
    <Route path="/sms-consent" element={<SmsConsent />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

// Try subdomain routes (try.novaracleaning.com) - New customer booking flow
const TryRoutes = () => (
  <Routes>
    {/* Default route - start booking */}
    <Route path="/" element={<Navigate to="/book/zip" replace />} />
    
    {/* Booking flow */}
    <Route path="/book/zip" element={<BookingZip />} />
    <Route path="/book/sqft" element={<BookingHome />} />
    <Route path="/book/offer" element={<BookingOffer />} />
    <Route path="/book/checkout" element={<BookingCheckout />} />
    <Route path="/book/details" element={<PropertyDetails />} />
    <Route path="/book/confirmation" element={<BookingSuccess />} />
    <Route path="/book/custom-quote" element={<CustomQuote />} />
    
    {/* Legacy booking redirects */}
    <Route path="/book/home" element={<Navigate to="/book/sqft" replace />} />
    <Route path="/book/service" element={<Navigate to="/book/offer" replace />} />
    <Route path="/book/schedule" element={<Navigate to="/book/checkout" replace />} />
    <Route path="/book/summary" element={<Navigate to="/book/checkout" replace />} />
    <Route path="/book/success" element={<Navigate to="/book/confirmation" replace />} />
    
    {/* Auth for guest checkout */}
    <Route path="/auth" element={<Auth />} />
    <Route path="/auth/callback" element={<AuthCallback />} />
    
    <Route path="*" element={<Navigate to="/book/zip" replace />} />
  </Routes>
);

// App subdomain routes (app.novaracleaning.com) - Existing customer portal ONLY
const AppRoutes = () => (
  <Routes>
    {/* Default route - account/dashboard */}
    <Route path="/" element={<Navigate to="/account" replace />} />
    
    {/* Customer portal */}
    <Route path="/account" element={<Account />} />
    <Route path="/membership" element={<Membership />} />
    
    {/* Auth routes */}
    <Route path="/auth" element={<Auth />} />
    <Route path="/auth/callback" element={<AuthCallback />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/update-password" element={<UpdatePassword />} />
    
    {/* NO booking routes - redirect to try subdomain */}
    <Route path="/book/*" element={<NotFound />} />
    
    <Route path="*" element={<NotFound />} />
  </Routes>
);

// Main domain routes (novaracleaning.com) - Landing page only, no booking
const MainRoutes = () => (
  <Routes>
    {/* Public pages */}
    <Route path="/" element={<Index />} />
    <Route path="/demo" element={<Demo />} />
    
    {/* NO booking on main domain - booking is ONLY on try.novaracleaning.com */}
    <Route path="/book/*" element={<NotFound />} />
    
    {/* NO admin on main domain - admin is ONLY on admin.novaracleaning.com */}
    <Route path="/admin/*" element={<NotFound />} />
    
    {/* NO cleaner portal on main domain - cleaner is ONLY on contractor.novaracleaning.com */}
    <Route path="/cleaner/*" element={<NotFound />} />
    
    {/* Hiring redirects to hiring subdomain info */}
    <Route path="/hiring" element={<Hiring />} />
    <Route path="/careers" element={<Hiring />} />
    <Route path="/join" element={<Hiring />} />
    <Route path="/apply" element={<Hiring />} />
    
    <Route path="/sms-consent" element={<SmsConsent />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

// Hiring subdomain routes (hiring.novaracleaning.com)
const HiringRoutes = () => (
  <Routes>
    {/* Main hiring page */}
    <Route path="/" element={<Hiring />} />
    <Route path="/apply" element={<Hiring />} />
    <Route path="/careers" element={<Hiring />} />
    <Route path="/jobs" element={<Hiring />} />
    
    {/* Position-specific routes */}
    <Route path="/field-cleaner" element={<Hiring />} />
    <Route path="/ops-coordinator" element={<Hiring />} />
    <Route path="/executive-assistant" element={<Hiring />} />
    
    {/* Legacy cleaner onboarding for existing applicants */}
    <Route path="/onboarding" element={<OnboardingLanding />} />
    <Route path="/cleaner/onboarding" element={<OnboardingLanding />} />
    
    <Route path="*" element={<Hiring />} />
  </Routes>
);

// Get the right routes based on subdomain
const getSubdomainRoutes = () => {
  switch (CURRENT_SUBDOMAIN) {
    case 'admin':
      return <AdminRoutes />;
    case 'contractor':
      return <ContractorRoutes />;
    case 'try':
      return <TryRoutes />;
    case 'app':
      return <AppRoutes />;
    case 'hiring':
      return <HiringRoutes />;
    default:
      return <MainRoutes />;
  }
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <BookingProvider>
            {getSubdomainRoutes()}
          </BookingProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
