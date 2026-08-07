/**
 * Prefer a committed extra.eas.projectId (from `eas init`).
 * On EAS Build workers, fall back to EAS_BUILD_PROJECT_ID so GitHub-triggered
 * builds can run before that ID is committed.
 */
module.exports = ({ config }) => {
  const projectId =
    config.extra?.eas?.projectId ||
    process.env.EAS_BUILD_PROJECT_ID ||
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    undefined;

  return {
    ...config,
    extra: {
      ...config.extra,
      eas: {
        ...(config.extra?.eas ?? {}),
        ...(projectId ? { projectId } : {}),
      },
    },
  };
};
