import { Suspense, lazy, useEffect, useState } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { App as CapApp } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { AuthProvider } from "@/contexts/AuthContext";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { supabase } from "@/integrations/supabase/client";

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

// Handle deep links: OAuth callbacks (exchange the PKCE code for a session)
// and generic app links (route into the hash router). Tapping a push that
// carries a route is handled inside use-push-notifications.
async function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get("code");
    if (code && (url.includes("/auth/callback") || url.includes("code="))) {
      try {
        await supabase.auth.exchangeCodeForSession(code);
      } catch (e) {
        console.warn("[deeplink] code exchange failed", e);
      }
      window.location.hash = "#/cleaner/auth/callback";
      return;
    }
    const path = (parsed.pathname || "/") + (parsed.search || "");
    if (path && path !== "/") window.location.hash = `#${path}`;
  } catch {
    /* ignore malformed urls */
  }
}

// Native shell bootstrap: registers push, hides the splash, styles the
// status bar, and wires deep links. All no-ops on web.
function NativeBootstrap() {
  usePushNotifications();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    const t = setTimeout(() => SplashScreen.hide().catch(() => {}), 300);

    let urlSub: { remove: () => void } | undefined;
    CapApp.addListener("appUrlOpen", ({ url }) => void handleDeepLink(url))
      .then((h) => {
        urlSub = h;
      })
      .catch(() => {});

    return () => {
      clearTimeout(t);
      try {
        urlSub?.remove();
      } catch {
        /* noop */
      }
    };
  }, []);
  return null;
}

// Thin offline indicator. The dashboard separately caches its last payload
// so the screen stays useful with no connection.
function NetworkBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    Network.getStatus()
      .then((s) => setOnline(s.connected))
      .catch(() => {});
    Network.addListener("networkStatusChange", (s) => setOnline(s.connected))
      .then((h) => {
        sub = h;
      })
      .catch(() => {});
    return () => {
      try {
        sub?.remove();
      } catch {
        /* noop */
      }
    };
  }, []);

  if (online) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] bg-amber-500 py-1 text-center text-xs font-medium text-white">
      You&apos;re offline — showing last saved data
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NativeBootstrap />
        <NetworkBanner />
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
