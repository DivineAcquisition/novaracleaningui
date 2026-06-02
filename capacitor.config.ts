import { CapacitorConfig } from '@capacitor/cli';

// ─── Novara Pro — contractor mobile app ─────────────────────────────────────
//
// This is a TRUE bundled app: the contractor portal is built as a static
// client SPA (see /mobile) and shipped inside the native binary via `webDir`.
// We intentionally do NOT set `server.url` — that would turn the app into a
// thin webview of the live site (Apple App Store guideline 4.2 rejection
// risk and fragile native-plugin behaviour). The SPA talks to Supabase +
// edge functions directly over HTTPS and persists the session in
// localStorage, which works inside the Capacitor WebView.
const config: CapacitorConfig = {
  appId: 'com.novaracleaning.contractor',
  appName: 'Novara Pro',
  // Static SPA build output (vite build in /mobile). Run `npm run build`
  // inside /mobile, then `npx cap sync` from the repo root.
  webDir: 'mobile/dist',
  ios: {
    contentInset: 'always',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0F172A',
      showSpinner: false,
      androidSpinnerStyle: 'small',
      iosSpinnerStyle: 'small',
      spinnerColor: '#7C3AED',
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0F172A',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#7C3AED',
    },
  },
};

export default config;
