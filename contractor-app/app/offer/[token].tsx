import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AssignmentRow,
  formatAddress,
  formatMoney,
  formatServiceType,
  formatWhen,
  respondToOffer,
} from "../../src/lib/jobs";
import { useSession } from "../../src/lib/session";
import { supabase } from "../../src/lib/supabase";
import { theme } from "../../src/lib/theme";

/** Maps accept-job-offer's refusal reasons to something a cleaner can act on. */
const REASON_COPY: Record<string, string> = {
  overlap: "You're already booked for a job that overlaps this one.",
  expired: "This offer expired.",
  taken: "Another cleaner took this job first.",
  not_found: "We couldn't find this offer.",
  missing_job: "This job is no longer available.",
};

export default function OfferDetail() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { cleaner } = useSession();
  const [offer, setOffer] = useState<AssignmentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const { data, error: queryError } = await supabase
        .from("job_assignments")
        .select(
          `id, role, status, estimated_pay_cents, pay_percentage_snapshot, crew_size_snapshot,
           distance_miles, response_token, assigned_at, expires_at,
           jobs ( id, service_type, start_datetime, address, city, state, zip,
                  duration_est_hours, check_in_time, status )`,
        )
        .eq("response_token", token)
        .maybeSingle();
      if (queryError) throw queryError;
      setOffer(data as unknown as AssignmentRow | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(action: "accept" | "decline") {
    if (!token) return;
    setBusy(action);
    setError(null);
    const result = await respondToOffer(token, action);
    setBusy(null);

    if (!result.ok) {
      const message =
        result.message || REASON_COPY[result.reason ?? ""] || "Could not submit your response.";
      setError(message);
      await load();
      return;
    }

    Alert.alert(
      action === "accept" ? "Job accepted" : "Offer declined",
      action === "accept"
        ? "It's on your schedule now. Check in from the job screen when you arrive."
        : "Thanks — we'll offer it to someone else.",
      [{ text: "OK", onPress: () => router.replace("/") }],
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (!offer) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Offer not found</Text>
        <Text style={styles.body}>It may have expired or been taken.</Text>
      </View>
    );
  }

  const job = offer.jobs;
  const status = (offer.status ?? "").toLowerCase();
  const isOpen = status === "offered" || status === "broadcast";
  const expired = !!offer.expires_at && new Date(offer.expires_at).getTime() < Date.now();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.service}>{formatServiceType(job?.service_type)}</Text>
      <Text style={styles.pay}>{formatMoney(offer.estimated_pay_cents)}</Text>
      <Text style={styles.payNote}>
        Your estimated pay
        {offer.pay_percentage_snapshot ? ` · ${offer.pay_percentage_snapshot}% tier` : ""}
        {offer.crew_size_snapshot && offer.crew_size_snapshot > 1
          ? ` · crew of ${offer.crew_size_snapshot}`
          : ""}
      </Text>

      <View style={styles.card}>
        <Row label="When" value={formatWhen(job)} />
        <Row label="Where" value={formatAddress(job) || "Address shared on accept"} />
        {job?.duration_est_hours ? (
          <Row label="Estimated" value={`${job.duration_est_hours} hours`} />
        ) : null}
        {offer.role ? <Row label="Role" value={offer.role} /> : null}
        {typeof offer.distance_miles === "number" ? (
          <Row label="Distance" value={`${offer.distance_miles.toFixed(1)} miles`} />
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!isOpen ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            This offer is already {offer.status}. Nothing more to do here.
          </Text>
        </View>
      ) : expired ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>This offer has expired.</Text>
        </View>
      ) : !cleaner ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>Sign in to respond to this offer.</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable
            style={[styles.accept, busy && styles.disabled]}
            disabled={!!busy}
            onPress={() => void respond("accept")}
          >
            {busy === "accept" ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <Text style={styles.acceptText}>Accept job</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.decline, busy && styles.disabled]}
            disabled={!!busy}
            onPress={() => void respond("decline")}
          >
            {busy === "decline" ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <Text style={styles.declineText}>Decline</Text>
            )}
          </Pressable>
        </View>
      )}
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
  centered: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 8,
  },
  title: { color: theme.text, fontSize: 18, fontWeight: "600" },
  body: { color: theme.textMuted, fontSize: 14, textAlign: "center" },
  service: { color: theme.textMuted, fontSize: 15 },
  pay: { color: theme.success, fontSize: 40, fontWeight: "700", marginTop: 4 },
  payNote: { color: theme.textMuted, fontSize: 13, marginBottom: 24 },
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
  notice: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 10,
    padding: 14,
    marginTop: 24,
  },
  noticeText: { color: theme.text, fontSize: 14, lineHeight: 20 },
  actions: { marginTop: 28, gap: 12 },
  accept: {
    backgroundColor: theme.success,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  acceptText: { color: theme.accentText, fontSize: 16, fontWeight: "700" },
  decline: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
  },
  declineText: { color: theme.text, fontSize: 15, fontWeight: "600" },
  disabled: { opacity: 0.6 },
});
