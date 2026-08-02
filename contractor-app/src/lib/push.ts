// Device-token registration. Writes to the same `cleaner_device_tokens` table
// the Capacitor app uses; `send-push` routes on token shape, so the
// ExponentPushToken[...] stored here goes out via Expo while any legacy raw
// APNs/FCM tokens keep using the direct transports.

import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Ask for permission, get the Expo push token, and upsert it for this cleaner.
 * Returns the token, or null when push isn't available (simulator, denied
 * permission, no EAS project id yet).
 */
export async function registerForPush(
  userId: string,
  cleanerId: string | null,
): Promise<string | null> {
  if (!Device.isDevice) return null;

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return null;

  // Set before the token call so the first Android notification already has a
  // channel to land in.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Job alerts",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#7C3AED",
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  if (!projectId) {
    // `eas init` hasn't linked this app yet. Everything else still works.
    console.warn("[push] no EAS project id — skipping token registration");
    return null;
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

  const { error } = await supabase.from("cleaner_device_tokens").upsert(
    {
      token,
      user_id: userId,
      cleaner_id: cleanerId,
      platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "unknown",
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" },
  );
  if (error) console.warn("[push] token upsert failed", error.message);

  return token;
}
