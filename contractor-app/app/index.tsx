import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { JobCard } from "../src/components/JobCard";
import { isBlockedCleanerStatus } from "../src/lib/cleaner-auth";
import { AssignmentRow, UpcomingJob, fetchOpenOffers, fetchUpcomingJobs } from "../src/lib/jobs";
import { useSession } from "../src/lib/session";
import { theme } from "../src/lib/theme";

type Tab = "jobs" | "offers";

export default function Home() {
  const router = useRouter();
  const { cleaner, needsOnboarding, signOut } = useSession();
  const [tab, setTab] = useState<Tab>("jobs");
  const [jobs, setJobs] = useState<UpcomingJob[]>([]);
  const [offers, setOffers] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cleaner?.id) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [nextJobs, nextOffers] = await Promise.all([
        fetchUpcomingJobs(cleaner.id),
        fetchOpenOffers(cleaner.id),
      ]);
      setJobs(nextJobs);
      setOffers(nextOffers);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cleaner?.id]);

  // Reload on focus so accepting an offer on the detail screen is reflected
  // the moment the cleaner comes back here.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (needsOnboarding || !cleaner) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Finish onboarding first</Text>
        <Text style={styles.emptyBody}>
          We couldn&apos;t find a completed contractor profile for this login. Finish onboarding at
          contractor.novaracleaning.com, then come back.
        </Text>
        <Pressable style={styles.secondaryButton} onPress={() => void signOut()}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  if (isBlockedCleanerStatus(cleaner.status)) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Account inactive</Text>
        <Text style={styles.emptyBody}>Contact support if you think this is a mistake.</Text>
        <Pressable style={styles.secondaryButton} onPress={() => void signOut()}>
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  const isSuspended = (cleaner.status ?? "").toLowerCase() === "suspended";
  const list = tab === "jobs" ? jobs : offers;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.textMuted}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={styles.headerRow}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.greeting}>Hi {cleaner.first_name || "there"}</Text>
          <Text style={styles.subGreeting}>
            {jobs.length} upcoming · {offers.length} open offer{offers.length === 1 ? "" : "s"}
          </Text>
        </View>
        <Link href="/profile" asChild>
          <Pressable style={styles.profileButton}>
            <Text style={styles.profileButtonText}>Profile</Text>
          </Pressable>
        </Link>
      </View>

      {isSuspended ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Your account is suspended — new offers are paused. Jobs you already accepted are
            unaffected.
          </Text>
        </View>
      ) : null}

      <View style={styles.tabs}>
        {(["jobs", "offers"] as Tab[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === "jobs" ? `Upcoming (${jobs.length})` : `Offers (${offers.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }} />
      ) : list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>
            {tab === "jobs" ? "No upcoming jobs" : "No open offers"}
          </Text>
          <Text style={styles.emptyBody}>
            {tab === "jobs"
              ? "Accepted jobs show up here with directions and check-in."
              : "We'll notify you the moment a job near you needs a cleaner."}
          </Text>
        </View>
      ) : tab === "jobs" ? (
        jobs.map(({ assignment, booking }) => (
          <JobCard
            key={assignment.id}
            assignment={assignment}
            booking={booking}
            badge={(assignment.status ?? "").toLowerCase() === "in progress" ? "On site" : undefined}
            onPress={() => router.push(`/job/${assignment.id}`)}
          />
        ))
      ) : (
        offers.map((offer) => (
          <JobCard
            key={offer.id}
            assignment={offer}
            badge="Offer"
            onPress={() =>
              offer.response_token
                ? router.push(`/offer/${offer.response_token}`)
                : undefined
            }
          />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, paddingBottom: 48 },
  centered: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  greeting: { color: theme.text, fontSize: 24, fontWeight: "700" },
  subGreeting: { color: theme.textMuted, fontSize: 13, marginTop: 2 },
  profileButton: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  profileButtonText: { color: theme.text, fontSize: 13, fontWeight: "600" },
  banner: {
    backgroundColor: theme.surfaceAlt,
    borderLeftColor: theme.warning,
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  bannerText: { color: theme.text, fontSize: 13, lineHeight: 18 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 16 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
  },
  tabActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  tabText: { color: theme.textMuted, fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: theme.accentText },
  empty: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { color: theme.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  emptyBody: { color: theme.textMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },
  error: { color: theme.warning, marginBottom: 12, fontSize: 13 },
  secondaryButton: {
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 11,
    marginTop: 8,
  },
  secondaryButtonText: { color: theme.text, fontSize: 14, fontWeight: "600" },
});
