"use client";

import { useState, useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

// Persist a freshly-registered device token so the backend can push job
// offers / assignment alerts to this cleaner. Best-effort — never throws.
// `cleaner_device_tokens` isn't in the generated DB types yet, so the
// query builder is cast to bypass the typed table allowlist.
async function persistDeviceToken(token: string) {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return;

    const { data: cleaner } = await supabase
      .from('cleaners')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    const cleanerId = (cleaner as { id?: string } | null)?.id ?? null;

    const platform = Capacitor.getPlatform();
    // deno-lint-ignore no-explicit-any
    await (supabase.from as any)('cleaner_device_tokens').upsert(
      {
        token,
        user_id: userId,
        cleaner_id: cleanerId,
        platform: platform === 'ios' || platform === 'android' ? platform : 'unknown',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );
  } catch (err) {
    console.warn('[push] Failed to persist device token', err);
  }
}

// Map a tapped push to an in-app route. Uses the hash router so a hard
// navigation works inside the bundled SPA.
function routeFromPushData(data: Record<string, unknown> | undefined) {
  if (!data) return;
  const type = String(data.type || '');
  if (type === 'new_opportunity' || type === 'job_offer') {
    window.location.hash = '#/cleaner/job-offers';
  } else if (type === 'assignment' || type === 'job_assigned') {
    window.location.hash = '#/cleaner/dashboard';
  } else if (typeof data.route === 'string' && data.route.startsWith('/')) {
    window.location.hash = `#${data.route}`;
  }
}

export function usePushNotifications() {
  const [token, setToken] = useState<string | null>(null);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!isNative) return;

    const setupPushNotifications = async () => {
      try {
        // Request permission
        const permission = await PushNotifications.requestPermissions();

        if (permission.receive === 'granted') {
          // Register with Apple / Google to receive push via APNS/FCM
          await PushNotifications.register();
        }
      } catch (error) {
        console.error('Push notification setup error:', error);
      }
    };

    // Register listeners
    PushNotifications.addListener('registration', (token) => {
      console.log('Push registration success, token:', token.value);
      setToken(token.value);
      // Save the token to the backend so edge functions can target this device.
      void persistDeviceToken(token.value);
    });

    PushNotifications.addListener('registrationError', (error) => {
      console.error('Push registration error:', error);
    });

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('Push notification received:', notification);
      toast({
        title: notification.title || 'New notification',
        description: notification.body,
      });
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('Push notification action performed:', action);
      // Tapping the notification deep-links into the relevant screen.
      routeFromPushData(action?.notification?.data as Record<string, unknown> | undefined);
    });

    setupPushNotifications();

    return () => {
      PushNotifications.removeAllListeners();
    };
  }, [isNative]);

  return { token, isNative };
}
