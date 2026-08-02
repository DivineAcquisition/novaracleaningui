import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AssignmentRow,
  BookingLite,
  checkInOut,
  formatAddress,
  formatMoney,
  formatServiceType,
  formatWhen,
  markJobComplete,
} from "../../src/lib/jobs";
import { useSession } from "../../src/lib/session";
import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/lib/theme";

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { cleaner } = useSession();
  const [assignment, setAssignment] = useState<AssignmentRow | null>(null);
  const [booking, setBooking] = useState<BookingLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const { data, error: queryError } = await supabase
        .from("job_assignments")
        .select(
          `id, role, status, estimated_pay_cents, pay_percentage_snapshot, crew_size_snapshot,
           distance_miles, response_token, assigned_at, expires_at,
           jobs ( id, service_type, start_datetime, address, city, state, zip,
                  duration_est_hours, check_in_time, status )`,
        )
        .eq("id", id)
        .maybeSingle();
      if (queryError) throw queryError;

      const row = data as unknown as AssignmentRow | null;
      setAssignment(row);

      if (row?.jobs?.id) {
        const { data: bookingRow } = await supabase
          .from("bookings")
          .select("id, job_id, service_date, time_slot, arrival_window, status")
          .eq("job_id", row.jobs.id)
          .maybeSingle();
        setBooking((bookingRow as BookingLite) ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCheckIn() {
    if (!assignment || !cleaner) return;
    setBusy("check_in");
    setError(null);
    const result = await checkInOut({
      jobAssignmentId: assignment.id,
      bookingId: booking?.id,
      cleanerId: cleaner.id,
      action: "check_in",
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.message || "Check-in failed.");
      return;
    }
    await load();
    Alert.alert("Checked in", "You're on the clock. Take your before photos.");
  }

  async function onComplete() {
    if (!booking?.id || !cleaner) {
      setError("This job has no booking attached — contact dispatch.");
      return;
    }
    Alert.alert("Mark this job complete?", "Dispatch will review it and release your pay.", [
      { text: "Not yet", style: "cancel" },
      {
        text: "Mark complete",
        style: "default",
        onPress: async () => {
          setBusy("complete");
          setError(null);
          const result = await markJobComplete(booking.id, cleaner.id);
          setBusy(null);
          if (!result.ok) {
            setError(result.error || "Could not mark complete.");
            return;
          }
          if (result.photoUploadUrl) {
            Alert.alert(
              "Job submitted",
              "Upload your after photos to finish. We also texted you the link.",
              [
                { text: "Later", onPress: () => router.replace("/") },
                {
                  text: "Upload photos",
                  onPress: () => {
                    void Linking.openURL(result.photoUploadUrl!);
                    router.replace("/");
                  },
                },
              ],
            );
          } else {
            Alert.alert("Job submitted", "Dispatch will review it shortly.", [
              { text: "OK", onPress: () => router.replace("/") },
            ]);
          }
        },
      },
    ]);
  }

  function openDirections() {
    const address = formatAddress(assignment?.jobs ?? null);
    if (!address) return;
    const query = encodeURIComponent(address.replace(/ · /g, " "));
    // Apple Maps on iOS, Google Maps elsewhere — both accept a plain query.
    const url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?daddr=${query}`
        : `https://www.google.com/maps/dir/?api=1&destination=${query}`;
    void Linking.openURL(url);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (!assignment) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Job not found</Text>
      </View>
    );
  }

  const job = assignment.jobs;
  const address = formatAddress(job);
  const checkedIn = !!job?.check_in_time || (assignment.status ?? "").toLowerCase() === "in progress";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.service}>{formatServiceType(job?.service_type)}</Text>
      <Text style={styles.when}>{formatWhen(job, booking)}</Text>

      <View style={styles.card}>
        <Row label="Your pay" value={formatMoney(assignment.estimated_pay_cents)} />
        <Row label="Address" value={address || "Contact dispatch"} />
        {job?.duration_est_hours ? (
          <Row label="Estimated" value={`${job.duration_est_hours} hours`} />
        ) : null}
        {assignment.role ? <Row label="Role" value={assignment.role} /> : null}
        <Row label="Status" value={checkedIn ? "On site" : (assignment.status ?? "Confirmed")} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        {address ? (
          <Pressable style={styles.secondary} onPress={openDirections}>
            <Text style={styles.secondaryText}>Get directions</Text>
          </Pressable>
        ) : null}

        {!checkedIn ? (
          <Pressable
            style={[styles.primary, busy && styles.disabled]}
            disabled={!!busy}
            onPress={() => void onCheckIn()}
          >
            {busy === "check_in" ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <Text style={styles.primaryText}>Check in</Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            style={[styles.complete, busy && styles.disabled]}
            disabled={!!busy}
            onPress={() => void onComplete()}
          >
            {busy === "complete" ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <Text style={styles.primaryText}>Mark complete</Text>
            )}
          </Pressable>
        )}

        {assignment.response_token ? (
          <Pressable
            style={styles.secondary}
            onPress={() =>
              Linking.openURL(
                `https://contractor.novaracleaning.com/cleaner/job-checklist/${assignment.response_token}`,
              )
            }
          >
            <Text style={styles.secondaryText}>Open checklist</Text>
          </Pressable>
        ) : null}
      </View>
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
  centered: { flex: 1, backgroundColor: theme.bg, alignItems: "center", justifyContent: "center" },
  title: { color: theme.text, fontSize: 18, fontWeight: "600" },
  service: { color: theme.text, fontSize: 24, fontWeight: "700" },
  when: { color: theme.textMuted, fontSize: 15, marginTop: 4, marginBottom: 22 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    gap: 14,
  },
  row: { gap: 3 },
  rowLabel: { color: theme.textMuted, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  rowValue: { color: theme.text, fontSize: 15, lineHeight: 21 },
  error: { color: theme.warning, marginTop: 16, fontSize: 14, lineHeight: 20 },
  actions: { marginTop: 28, gap: 12 },
  primary: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  complete: {
    backgroundColor: theme.success,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryText: { color: theme.accentText, fontSize: 16, fontWeight: "700" },
  secondary: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
  },
  secondaryText: { color: theme.text, fontSize: 15, fontWeight: "600" },
  disabled: { opacity: 0.6 },
});
