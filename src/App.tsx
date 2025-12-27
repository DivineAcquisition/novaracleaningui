import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import BookingSqft from "./pages/book/Sqft";
import BookingOffer from "./pages/book/Offer";
import BookingHome from "./pages/book/Home";
import BookingService from "./pages/book/Service";
import BookingSchedule from "./pages/book/Schedule";
import BookingDetails from "./pages/book/Details";
import BookingSummary from "./pages/book/Summary";
import BookingCheckout from "./pages/book/Checkout";
import BookingSuccess from "./pages/book/Success";
import BookingConfirmation from "./pages/book/Confirmation";
import AdditionalDetails from "./pages/book/AdditionalDetails";
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
import { ProtectedRoute } from "./components/ProtectedRoute";

const queryClient = new QueryClient();


const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <BookingProvider>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/demo" element={<Demo />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/account" element={<Account />} />
              <Route path="/membership" element={<Membership />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/update-password" element={<UpdatePassword />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/book/zip" element={<BookingZip />} />
              <Route path="/book/sqft" element={<BookingSqft />} />
              <Route path="/book/offer" element={<BookingOffer />} />
              <Route path="/book/home" element={<BookingHome />} />
              <Route path="/book/service" element={<BookingService />} />
              <Route path="/book/schedule" element={<BookingSchedule />} />
              <Route path="/book/details" element={<BookingDetails />} />
              <Route path="/book/summary" element={<BookingSummary />} />
              <Route path="/book/checkout" element={<BookingCheckout />} />
              <Route path="/book/success" element={<BookingSuccess />} />
              <Route path="/book/confirmation" element={<BookingConfirmation />} />
              <Route path="/book/additional-details" element={<AdditionalDetails />} />
              <Route path="/book/custom-quote" element={<CustomQuote />} />
              <Route path="/admin/cleaners" element={<ProtectedRoute requiredRole="admin"><AdminCleaners /></ProtectedRoute>} />
              <Route path="/admin/webhooks" element={<ProtectedRoute requiredRole="admin"><AdminWebhooks /></ProtectedRoute>} />
              <Route path="/admin/webhook-tester" element={<ProtectedRoute requiredRole="admin"><WebhookTester /></ProtectedRoute>} />
              <Route path="/admin/dispatch" element={<ProtectedRoute requiredRole="admin"><DispatchQueue /></ProtectedRoute>} />
              <Route path="/admin/directory" element={<ProtectedRoute requiredRole="admin"><CleanerDirectory /></ProtectedRoute>} />
              <Route path="/admin/intake" element={<BookingIntake />} />
              <Route path="/cleaner/auth" element={<CleanerAuth />} />
              <Route path="/cleaner/reset-password" element={<CleanerResetPassword />} />
              <Route path="/cleaner/dashboard" element={<CleanerDashboard />} />
              <Route path="/cleaner/mobile-dashboard" element={<MobileDashboard />} />
              <Route path="/cleaner/job-offers" element={<MobileJobOffers />} />
              <Route path="/cleaner/availability" element={<CleanerAvailability />} />
              <Route path="/cleaner/profile" element={<CleanerProfile />} />
              <Route path="/cleaner/onboarding-landing" element={<OnboardingLanding />} />
              <Route path="/cleaner/onboard" element={<OnboardingLanding />} /> {/* Legacy route */}
              <Route path="/cleaner/onboarding" element={<CleanerOnboarding />} />
              <Route path="/sms-consent" element={<SmsConsent />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BookingProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
