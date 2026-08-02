import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useSession } from "../src/lib/session";
import { theme } from "../src/lib/theme";

export default function Profile() {
  const { cleaner, session, signOut } = useSession();
  const router = useRouter();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.name}>
        {[cleaner?.first_name, cleaner?.last_name].filter(Boolean).join(" ") || "Contractor"}
      </Text>
      <Text style={styles.email}>{cleaner?.email || session?.user?.email}</Text>

      <View style={styles.card}>
        <Row label="Status" value={cleaner?.status ?? "—"} />
        <Row label="Pay tier" value={cleaner?.pay_tier ?? "—"} />
        <Row
          label="Pay rate"
          value={cleaner?.pay_percentage ? `${cleaner.pay_percentage}% of job value` : "—"}
        />
        <Row label="Payouts" value={cleaner?.payouts_enabled ? "Connected" : "Not set up"} />
        <Row label="Home ZIP" value={cleaner?.home_zip ?? "—"} />
      </View>

      <Pressable
        style={styles.signOut}
        onPress={async () => {
          await signOut();
          router.replace("/sign-in");
        }}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingBottom: 48 },
  name: { color: theme.text, fontSize: 24, fontWeight: "700" },
  email: { color: theme.textMuted, fontSize: 14, marginTop: 4, marginBottom: 24 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 14,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  rowLabel: { color: theme.textMuted, fontSize: 14 },
  rowValue: { color: theme.text, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  signOut: {
    borderColor: theme.danger,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 28,
  },
  signOutText: { color: theme.danger, fontSize: 15, fontWeight: "600" },
});
