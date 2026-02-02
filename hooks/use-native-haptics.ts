// Stub for native haptics - web version doesn't use native features
export function useNativeHaptics() {
  return {
    impact: async (_style?: 'light' | 'medium' | 'heavy') => {},
    notification: async (_type?: 'success' | 'warning' | 'error') => {},
    selectionStart: async () => {},
    selectionChanged: async () => {},
    selectionEnd: async () => {},
  };
}
