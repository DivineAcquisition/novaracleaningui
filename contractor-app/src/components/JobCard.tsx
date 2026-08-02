import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  AssignmentRow,
  BookingLite,
  formatAddress,
  formatMoney,
  formatServiceType,
  formatWhen,
} from "../lib/jobs";
import { theme } from "../lib/theme";

export function JobCard({
  assignment,
  booking,
  onPress,
  badge,
}: {
  assignment: AssignmentRow;
  booking?: BookingLite | null;
  onPress: () => void;
  badge?: string;
}) {
  const job = assignment.jobs;
  const address = formatAddress(job);

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.headerRow}>
        <Text style={styles.service}>{formatServiceType(job?.service_type)}</Text>
        <Text style={styles.pay}>{formatMoney(assignment.estimated_pay_cents)}</Text>
      </View>

      <Text style={styles.when}>{formatWhen(job, booking)}</Text>
      {address ? (
        <Text style={styles.address} numberOfLines={2}>
          {address}
        </Text>
      ) : null}

      <View style={styles.metaRow}>
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
        {assignment.role ? <Text style={styles.meta}>{assignment.role}</Text> : null}
        {typeof assignment.distance_miles === "number" ? (
          <Text style={styles.meta}>{assignment.distance_miles.toFixed(1)} mi</Text>
        ) : null}
        {job?.duration_est_hours ? (
          <Text style={styles.meta}>~{job.duration_est_hours}h</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginBottom: 12,
    gap: 6,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  service: { color: theme.text, fontSize: 16, fontWeight: "600", flexShrink: 1 },
  pay: { color: theme.success, fontSize: 16, fontWeight: "700", marginLeft: 12 },
  when: { color: theme.text, fontSize: 14 },
  address: { color: theme.textMuted, fontSize: 13, lineHeight: 18 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" },
  meta: { color: theme.textMuted, fontSize: 12 },
  badge: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: { color: theme.accentText, fontSize: 11, fontWeight: "700" },
});
