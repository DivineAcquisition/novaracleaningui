// Stub for Capacitor - web version doesn't use native features
export function useCapacitor() {
  return {
    isNative: false,
    platform: 'web' as const,
  };
}
