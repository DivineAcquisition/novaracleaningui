import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { BookingProvider } from "@/contexts/BookingContext";
import Index from "./pages/Index";
import BookingZip from "./pages/book/Zip";
import BookingHome from "./pages/book/Home";
import BookingService from "./pages/book/Service";
import BookingSchedule from "./pages/book/Schedule";
import BookingDetails from "./pages/book/Details";
import BookingSummary from "./pages/book/Summary";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <BookingProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/book/zip" element={<BookingZip />} />
            <Route path="/book/home" element={<BookingHome />} />
            <Route path="/book/service" element={<BookingService />} />
            <Route path="/book/schedule" element={<BookingSchedule />} />
            <Route path="/book/details" element={<BookingDetails />} />
            <Route path="/book/summary" element={<BookingSummary />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BookingProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
