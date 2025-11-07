import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { BookingProvider } from "@/contexts/BookingContext";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Account from "./pages/Account";
import BookingZip from "./pages/book/Zip";
import BookingHome from "./pages/book/Home";
import BookingService from "./pages/book/Service";
import BookingSchedule from "./pages/book/Schedule";
import BookingDetails from "./pages/book/Details";
import BookingSummary from "./pages/book/Summary";
import BookingCheckout from "./pages/book/Checkout";
import BookingSuccess from "./pages/book/Success";
import CustomQuote from "./pages/book/CustomQuote";
import NotFound from "./pages/NotFound";

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
              <Route path="/auth" element={<Auth />} />
              <Route path="/account" element={<Account />} />
              <Route path="/book/zip" element={<BookingZip />} />
              <Route path="/book/home" element={<BookingHome />} />
              <Route path="/book/service" element={<BookingService />} />
              <Route path="/book/schedule" element={<BookingSchedule />} />
              <Route path="/book/details" element={<BookingDetails />} />
              <Route path="/book/summary" element={<BookingSummary />} />
              <Route path="/book/checkout" element={<BookingCheckout />} />
              <Route path="/book/success" element={<BookingSuccess />} />
              <Route path="/book/custom-quote" element={<CustomQuote />} />
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
