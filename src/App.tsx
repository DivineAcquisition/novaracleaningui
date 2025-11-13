import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { BookingProvider } from "@/contexts/BookingContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { useEffect } from "react";
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
import BookingService from "./pages/book/Service";
import BookingSchedule from "./pages/book/Schedule";
import BookingDetails from "./pages/book/Details";
import BookingSummary from "./pages/book/Summary";
import BookingCheckout from "./pages/book/Checkout";
import BookingSuccess from "./pages/book/Success";
import AdditionalDetails from "./pages/book/AdditionalDetails";
import CustomQuote from "./pages/book/CustomQuote";
import NotFound from "./pages/NotFound";
import AdminCleaners from "./pages/admin/Cleaners";
import CleanerAuth from "./pages/cleaner/Auth";
import CleanerResetPassword from "./pages/cleaner/ResetPassword";
import CleanerDashboard from "./pages/cleaner/Dashboard";
import CleanerProfile from "./pages/cleaner/Profile";

const queryClient = new QueryClient();

// Domain-aware routing component
const DomainRouter = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const isContractorDomain = window.location.hostname.includes('contractor');
    const isCleanerRoute = location.pathname.startsWith('/cleaner') || location.pathname.startsWith('/admin');
    
    // If on contractor domain but not on cleaner/admin route, redirect to cleaner auth
    if (isContractorDomain && !isCleanerRoute) {
      navigate('/cleaner/auth', { replace: true });
    }
    
    // If on main domain but on cleaner route, redirect to contractor domain if available
    if (!isContractorDomain && isCleanerRoute) {
      const contractorUrl = window.location.href.replace(
        window.location.hostname,
        'contractor.' + window.location.hostname
      );
      window.location.href = contractorUrl;
    }
  }, [location.pathname, navigate]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <BookingProvider>
            <DomainRouter />
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
              <Route path="/book/home" element={<BookingHome />} />
              <Route path="/book/service" element={<BookingService />} />
              <Route path="/book/schedule" element={<BookingSchedule />} />
              <Route path="/book/details" element={<BookingDetails />} />
              <Route path="/book/summary" element={<BookingSummary />} />
              <Route path="/book/checkout" element={<BookingCheckout />} />
              <Route path="/book/success" element={<BookingSuccess />} />
              <Route path="/book/additional-details" element={<AdditionalDetails />} />
              <Route path="/book/custom-quote" element={<CustomQuote />} />
              <Route path="/admin/cleaners" element={<AdminCleaners />} />
              <Route path="/cleaner/auth" element={<CleanerAuth />} />
              <Route path="/cleaner/reset-password" element={<CleanerResetPassword />} />
              <Route path="/cleaner/dashboard" element={<CleanerDashboard />} />
              <Route path="/cleaner/profile" element={<CleanerProfile />} />
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
