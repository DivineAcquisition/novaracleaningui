import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.novaracleaning.cleaner',
  appName: 'Novara Cleaner',
  webDir: 'dist',
  server: {
    url: 'https://68c221bb-3881-41de-a9f5-ce49690f4058.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0F172A',
      showSpinner: false,
      androidSpinnerStyle: 'small',
      iosSpinnerStyle: 'small',
      spinnerColor: '#3B82F6'
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0F172A'
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#3B82F6'
    }
  }
};

export default config;
