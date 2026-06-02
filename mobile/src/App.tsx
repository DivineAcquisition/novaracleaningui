import { Suspense, lazy } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/AuthContext";

// Reuse the existing cleaner screens verbatim (default exports).
const Auth = lazy(() => import("@/views/cleaner/Auth"));
const AuthCallback = lazy(() => import("@/views/cleaner/AuthCallback"));
const MobileDashboard = lazy(() => import("@/views/cleaner/MobileDashboard"));
const MobileJobOffers = lazy(() => import("@/views/cleaner/MobileJobOffers"));
const JobOffer = lazy(() => import("@/views/cleaner/JobOffer"));
const JobPhotos = lazy(() => import("@/views/cleaner/JobPhotos"));
const Profile = lazy(() => import("@/views/cleaner/Profile"));
const Availability = lazy(() => import("@/views/cleaner/Availability"));
const Onboarding = lazy(() => import("@/views/cleaner/Onboarding"));
const OnboardingPortal = lazy(() => import("@/views/cleaner/OnboardingPortal"));
const RoleIntro = lazy(() => import("@/views/cleaner/RoleIntro"));
const Training = lazy(() => import("@/views/cleaner/Training"));
const ResetPassword = lazy(() => import("@/views/cleaner/ResetPassword"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Splash() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#0F172A] text-white">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <HashRouter>
          <Suspense fallback={<Splash />}>
            <Routes>
              <Route path="/cleaner/auth" element={<Auth />} />
              <Route path="/cleaner/auth/callback" element={<AuthCallback />} />
              <Route path="/cleaner/reset-password" element={<ResetPassword />} />
              <Route path="/cleaner/dashboard" element={<MobileDashboard />} />
              <Route path="/cleaner/mobile-dashboard" element={<MobileDashboard />} />
              <Route path="/cleaner/job-offers" element={<MobileJobOffers />} />
              <Route path="/cleaner/job-offer/:token" element={<JobOffer />} />
              <Route path="/cleaner/job-photos/:token" element={<JobPhotos />} />
              <Route path="/cleaner/profile" element={<Profile />} />
              <Route path="/cleaner/availability" element={<Availability />} />
              <Route path="/cleaner/onboarding" element={<Onboarding />} />
              <Route path="/cleaner/ob-portal" element={<OnboardingPortal />} />
              <Route path="/cleaner/role" element={<RoleIntro />} />
              <Route path="/cleaner/training" element={<Training />} />
              <Route path="*" element={<Navigate to="/cleaner/mobile-dashboard" replace />} />
            </Routes>
          </Suspense>
          <Toaster position="top-center" richColors />
        </HashRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
