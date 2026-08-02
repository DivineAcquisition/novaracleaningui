import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { isBlockedCleanerStatus, resolveCleanerAuth } from "../src/lib/cleaner-auth";
import { supabase } from "../src/lib/supabase";
import { theme } from "../src/lib/theme";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }

      // Terminated/deactivated accounts must not reach the job list, matching
      // the gate the web dashboard applies.
      const { cleaner } = await resolveCleanerAuth();
      if (isBlockedCleanerStatus(cleaner?.status)) {
        await supabase.auth.signOut();
        setError("This account is no longer active. Contact support if that's wrong.");
        return;
      }

      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onForgotPassword() {
    if (!email.trim()) {
      setError("Enter your email first, then tap reset.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await supabase.functions.invoke("send-auth-email", {
        body: { kind: "password_reset_cleaner", email: email.trim().toLowerCase() },
      });
      setError("Check your email for a reset link.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>Novara Pro</Text>
          <Text style={styles.subtitle}>Sign in to see your jobs and offers.</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={theme.textMuted}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            placeholder="••••••••"
            placeholderTextColor={theme.textMuted}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={onSubmit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>

          <Pressable onPress={onForgotPassword} disabled={busy}>
            <Text style={styles.link}>Forgot password?</Text>
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              New contractors finish onboarding at contractor.novaracleaning.com before signing in
              here.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  container: { padding: 24, gap: 8, flexGrow: 1, justifyContent: "center" },
  brand: { color: theme.text, fontSize: 32, fontWeight: "700" },
  subtitle: { color: theme.textMuted, fontSize: 15, marginBottom: 24 },
  label: { color: theme.textMuted, fontSize: 13, marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 16,
  },
  error: { color: theme.warning, marginTop: 14, fontSize: 14 },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: theme.accentText, fontSize: 16, fontWeight: "600" },
  link: { color: theme.textMuted, textAlign: "center", marginTop: 18, fontSize: 14 },
  footer: { marginTop: 40 },
  footerText: { color: theme.textMuted, fontSize: 12, textAlign: "center", lineHeight: 18 },
});
