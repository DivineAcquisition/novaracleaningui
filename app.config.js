/**
 * Prefer a committed extra.eas.projectId (from `eas init`).
 * On EAS Build workers, fall back to EAS_BUILD_PROJECT_ID so GitHub-triggered
 * builds can run before that ID is committed.
 *
 * Identity is pinned so `eas integrations:supabase:connect` (and any other
 * EAS helper that rewrites app config) cannot replace Novara Pro with a
 * newly provisioned Expo or Supabase project.
 */
const NOVARA_PRO = {
  name: "Novara Pro",
  slug: "novarapro",
  scheme: "novarapro",
  bundleIdentifier: "com.novaracleaning.contractor",
  androidPackage: "com.novaracleaning.contractor",
  projectId: "897f0fbb-03bd-4cc2-b867-be5f8f471280",
  updatesUrl: "https://u.expo.dev/897f0fbb-03bd-4cc2-b867-be5f8f471280",
  supabaseUrl: "https://sxdraeptzuamsgjcvfeg.supabase.co",
};

module.exports = ({ config }) => {
  const projectId =
    config.extra?.eas?.projectId ||
    process.env.EAS_BUILD_PROJECT_ID ||
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    NOVARA_PRO.projectId;

  return {
    ...config,
    name: config.name || NOVARA_PRO.name,
    slug: NOVARA_PRO.slug,
    scheme: config.scheme || NOVARA_PRO.scheme,
    ios: {
      ...(config.ios ?? {}),
      bundleIdentifier:
        config.ios?.bundleIdentifier || NOVARA_PRO.bundleIdentifier,
    },
    android: {
      ...(config.android ?? {}),
      package: config.android?.package || NOVARA_PRO.androidPackage,
    },
    updates: {
      ...(config.updates ?? {}),
      url: config.updates?.url || NOVARA_PRO.updatesUrl,
    },
    extra: {
      ...config.extra,
      supabaseUrl: config.extra?.supabaseUrl || NOVARA_PRO.supabaseUrl,
      eas: {
        ...(config.extra?.eas ?? {}),
        projectId,
      },
    },
  };
};
