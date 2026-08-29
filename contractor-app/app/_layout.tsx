import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider, useSession } from "../src/lib/session";
import { theme } from "../src/lib/theme";

function RootNavigator() {
  const { loading, session } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "sign-in";
    if (!session && !inAuthGroup) router.replace("/sign-in");
    if (session && inAuthGroup) router.replace("/");
  }, [loading, session, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: "center" }}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="index" options={{ title: "Novara Pro" }} />
      <Stack.Screen name="job/[id]" options={{ title: "Job" }} />
      <Stack.Screen name="offer/[token]" options={{ title: "Job offer" }} />
      <Stack.Screen name="profile" options={{ title: "Profile" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
