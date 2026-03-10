"use client";

import { useState, useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { toast } from '@/hooks/use-toast';

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

    PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('Push notification action performed:', notification);
    });

    setupPushNotifications();

    return () => {
      PushNotifications.removeAllListeners();
    };
  }, [isNative]);

  return { token, isNative };
}
